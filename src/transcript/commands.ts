// What one segment of a shell command does, as far as tests are concerned:
// a recognised test run (and whether it runs the whole suite), something that
// might run tests, a read-only command, a directory change, or anything else,
// which may have modified files.
//
// Read-only commands are an explicit allow-list: an unknown command counts as
// a possible edit, so the order of runs and edits never rests on a guess that
// a command was harmless.
import { parsePytestArgs } from '../config/pytest.js';
import { analyseTestScript, parseJestArgs, parseVitestArgs, type ScriptRunner } from '../config/scripts.js';
import type { ExitUnknownReason, Framework, RunSelection, RunSummary } from '../evidence/schema.js';
import { commandWords, isNullDevice, programName, redirects, type Dialect, type Segment } from './shell.js';
import { nameTable, ownRecord } from '../util/names.js';

export type SegmentKind =
  | { kind: 'test'; framework: Framework; selection: RunSelection; /** Why it is not the whole suite. */ filter: string | null }
  | { kind: 'possible_test' }
  | { kind: 'readonly' }
  | { kind: 'cd'; dir: string }
  | { kind: 'mutating' };

/** package.json scripts where the command ran, or null when unknown. */
export type Scripts = Record<string, string> | null;

/** The `scripts` of a package.json text ({} without any); null when there is no file or it does not parse. */
export function packageScripts(text: string | null): Scripts {
  if (text === null) return null;
  try {
    // npm strips a leading byte-order mark before parsing.
    const json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as { scripts?: unknown };
    const scripts = json.scripts;
    if (scripts === undefined) return ownRecord({});
    if (typeof scripts !== 'object' || scripts === null) return null;
    return ownRecord(Object.fromEntries(Object.entries(scripts).filter(([, v]) => typeof v === 'string')) as Record<string, string>);
  } catch {
    return null;
  }
}

const PYTHONS = /^(python(\d+(\.\d+)*)?|py)$/;

// ---------------------------------------------------------------------------
// Selection: does the run cover the whole suite?

const PYTEST_EARLY_STOP = new Set(['-x', '--exitfirst', '--lf', '--last-failed', '--sw', '--stepwise', '--stepwise-skip', '--maxfail']);
const PYTEST_UNKNOWN_SCOPE = new Set(['-c', '--config-file', '-o', '--override-ini', '--rootdir', '--confcutdir', '--pyargs']);

function selectionFor(runner: ScriptRunner, args: string[]): { selection: RunSelection; filter: string | null } {
  const filtered = (filter: string): { selection: RunSelection; filter: string } => ({ selection: 'filtered', filter });
  if (runner === 'vitest') {
    const a = parseVitestArgs(args);
    if (a.filters.length) return filtered(a.filters.join(' '));
    if (a.opaque.length) return filtered(a.opaque.join(' '));
    const bail = args.find((w) => w === '--bail' || w.startsWith('--bail=') || w === '--changed' || w.startsWith('--changed='));
    if (bail) return filtered(bail);
    return { selection: 'full', filter: null };
  }
  if (runner === 'jest') {
    const a = parseJestArgs(args);
    if (a.opaque.length) return filtered(a.opaque.join(' '));
    const stop = args.find((w) => /^(--bail(=.*)?|-b|--onlyFailures|-f)$/.test(w));
    if (stop) return filtered(stop);
    return { selection: 'full', filter: null };
  }
  if (runner === 'pytest') {
    const a = parsePytestArgs(args);
    const paths = a.paths.filter((p) => p !== '.' && p !== './');
    if (paths.length) return filtered(paths.join(' '));
    if (a.k !== null) return filtered(`-k ${a.k}`);
    if (a.m !== null) return filtered(`-m ${a.m}`);
    if (a.deselect.length || a.ignore.length || a.ignoreGlob.length) return filtered([...a.deselect, ...a.ignore, ...a.ignoreGlob].join(' '));
    const stop = args.find((w) => PYTEST_EARLY_STOP.has(w.split('=')[0]!));
    if (stop) return filtered(stop);
    const unknown = args.find((w) => PYTEST_UNKNOWN_SCOPE.has(w.split('=')[0]!) || /^-[co]./.test(w));
    if (unknown || a.unclassified.length) return { selection: 'unknown', filter: unknown ?? a.unclassified.join(' ') };
    return { selection: 'full', filter: null };
  }
  // playwright
  const VALUE = /^(--grep|-g|--grep-invert|--project|--max-failures|--shard|--reporter|--workers|-j|--config|-c|--timeout|--retries|--output|--repeat-each)$/;
  const FILTER = /^(--grep|-g|--grep-invert|--project|--max-failures|--shard|--last-failed|--only-changed|-x)$/;
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!;
    const opt = w.split('=')[0]!;
    const value = w.includes('=') ? w.slice(w.indexOf('=') + 1) : VALUE.test(opt) ? args[++i] : undefined;
    if (!w.startsWith('-')) return filtered(w);
    if (FILTER.test(opt)) return filtered(value === undefined ? opt : `${opt} ${value}`);
  }
  return { selection: 'full', filter: null };
}

// ---------------------------------------------------------------------------
// Direct runner invocations

/** `vitest …`, `npx jest …`, `python -m pytest …`, `node node_modules/vitest/vitest.mjs …` → runner and its arguments. */
function directRunner(w: string[]): { runner: ScriptRunner; args: string[] } | null {
  let i = 0;
  const prog = (): string => programName(w[i] ?? '');
  // Launchers
  for (let hops = 0; hops < 3; hops++) {
    if (['npx', 'pnpx', 'bunx'].includes(prog())) {
      i++;
      while (w[i]?.startsWith('-')) i += w[i] === '-p' || w[i] === '--package' ? 2 : 1;
    } else if (['pnpm', 'yarn', 'bun'].includes(prog()) && ['exec', 'dlx', 'x'].includes(w[i + 1] ?? '')) i += 2;
    else if (prog() === 'node' && w[i + 1] && /(^|[\\/])(vitest([\\/]vitest\.mjs)?|jest([\\/]bin[\\/]jest\.js)?)$/.test(w[i + 1]!)) {
      const path = w[i + 1]!;
      return { runner: /vitest/.test(path) ? 'vitest' : 'jest', args: w.slice(i + 2) };
    } else break;
  }
  const p = prog();
  if (p === 'vitest' || p === 'jest') return { runner: p, args: w.slice(i + 1) };
  if (p === 'playwright' && w[i + 1] === 'test') return { runner: 'playwright', args: w.slice(i + 2) };
  if (p === 'pytest' || p === 'py.test') return { runner: 'pytest', args: w.slice(i + 1) };
  if (PYTHONS.test(p)) {
    let j = i + 1;
    while (w[j] && /^-[BIOqsuE]+$/.test(w[j]!)) j++;
    if (w[j] === '-m' && w[j + 1] === 'pytest') return { runner: 'pytest', args: w.slice(j + 2) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// npm / pnpm / yarn / bun scripts

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const QUIET_NPM_FLAGS = /^(--silent|-s|--if-present|-q|--quiet|--loglevel(=.*)?|--no-color|--color(=.*)?)$/;

/** `npm test -- -t x` → { script: 'test', forwarded: ['-t', 'x'], opaqueFlags: [] }. */
function scriptInvocation(w: string[]): { script: string; forwarded: string[]; opaqueFlags: string[] } | null {
  const pm = programName(w[0] ?? '');
  if (!PACKAGE_MANAGERS.has(pm)) return null;
  let i = 1;
  const flags: string[] = [];
  while (w[i]?.startsWith('-')) flags.push(w[i++]!);
  const sub = w[i];
  let script: string | undefined;
  if (sub === 'test' || sub === 't' || sub === 'tst') script = 'test';
  else if (sub === 'run' || sub === 'run-script') {
    i++;
    while (w[i]?.startsWith('-')) flags.push(w[i++]!);
    script = w[i];
  } else if (pm !== 'npm' && sub && !['install', 'add', 'remove', 'exec', 'dlx', 'x', 'i', 'ci', 'update', 'upgrade'].includes(sub)) {
    script = sub; // `yarn lint`, `pnpm test:unit`
  }
  if (!script) return null;
  const rest = w.slice(i + 1);
  const dd = rest.indexOf('--');
  // npm forwards only what follows `--`; yarn/pnpm/bun forward everything.
  const forwarded = pm === 'npm' ? (dd === -1 ? [] : rest.slice(dd + 1)) : rest.filter((x) => x !== '--');
  const before = pm === 'npm' ? (dd === -1 ? rest : rest.slice(0, dd)) : [];
  return { script, forwarded, opaqueFlags: [...flags, ...before].filter((f) => !QUIET_NPM_FLAGS.test(f)) };
}

function scriptRunner(scripts: Record<string, string>, name: string): { runner: ScriptRunner | null; known: boolean } {
  let current = name;
  for (let hops = 0; hops < 5; hops++) {
    const body = scripts[current];
    if (body === undefined) return { runner: null, known: false };
    // `"test": "npm run test:unit"` delegates to another script.
    const m = /^\s*(?:npm|pnpm|yarn|bun)\s+(?:run(?:-script)?\s+)?([\w:.-]+)\s*$/.exec(body);
    const next = m ? (m[1] === 't' || m[1] === 'tst' ? 'test' : m[1]!) : null;
    if (next && next !== current && scripts[next] !== undefined) {
      current = next;
      continue;
    }
    const a = analyseTestScript(body);
    const runners = [...new Set(a.runs.map((r) => r.runner))];
    return { runner: runners.length === 1 && a.opaque.length === 0 ? runners[0]! : null, known: runners.length > 0 };
  }
  return { runner: null, known: false };
}

// ---------------------------------------------------------------------------
// Read-only allow-list

const READONLY = new Set([
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'less', 'more', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'fd', 'tree',
  'pwd', 'echo', 'printf', 'which', 'where', 'whereis', 'file', 'stat', 'du', 'df', 'diff', 'cmp', 'uniq', 'cut', 'tr',
  'jq', 'date', 'printenv', 'true', 'false', 'sleep', 'basename', 'dirname', 'realpath', 'readlink', 'id', 'whoami',
  'uname', 'hostname', 'nproc', 'test', '[', 'export', 'set', 'unset', 'clear', 'cls', 'column', 'nl', 'od', 'xxd',
  'sha256sum', 'md5sum', 'shasum',
  // PowerShell
  'get-content', 'gc', 'get-childitem', 'gci', 'get-location', 'gl', 'select-string', 'sls', 'test-path', 'get-item',
  'gi', 'resolve-path', 'measure-object', 'select-object', 'where-object', 'sort-object', 'format-table', 'format-list',
  'out-string', 'write-output', 'write-host', 'get-command', 'gcm', 'get-date', 'get-filehash', 'get-itemproperty',
  'out-null', 'out-host', 'compare-object', 'get-location', 'join-path', 'split-path',
]);
const GIT_READONLY = new Set([
  'status', 'diff', 'log', 'show', 'ls-files', 'ls-tree', 'rev-parse', 'blame', 'grep', 'describe', 'cat-file', 'shortlog',
  'rev-list', 'merge-base', 'add', 'config', 'remote', 'branch', 'tag', '--version', 'help', 'check-ignore', 'name-rev',
]);

function isReadonly(w: string[]): boolean {
  const p = programName(w[0] ?? '');
  if (p === 'sed') return !w.some((x) => /^(-i|--in-place)/.test(x) || /^-[a-z]*i/.test(x));
  if (p === 'sort') return !w.some((x) => /^(-o|--output)/.test(x));
  if (p === 'find') return !w.some((x) => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprintf', '-fls'].includes(x));
  if (p === 'git') {
    let i = 1;
    while (w[i] === '-C' || w[i] === '-c' || w[i] === '--no-pager') i += w[i] === '--no-pager' ? 1 : 2;
    const sub = w[i] ?? '';
    if (sub === 'branch' || sub === 'tag' || sub === 'remote' || sub === 'config') return w.slice(i + 1).every((x) => x.startsWith('-') && !/^-[dDmMcC]$|^--(delete|move|copy|add|unset|replace-all|set-upstream)/.test(x)) || (sub === 'config' && w.includes('--get'));
    return GIT_READONLY.has(sub);
  }
  if (p === 'node' || PYTHONS.test(p) || p === 'npm' || p === 'pnpm' || p === 'yarn') {
    return w.length === 2 && /^(--version|-v|-V|version)$/.test(w[1]!);
  }
  if ((p === 'source' || p === '.') && w[1] && /activate(\.\w+)?$/.test(w[1])) return true;
  if (p.endsWith('activate') || p === 'activate.ps1') return true;
  return READONLY.has(p);
}

const POSSIBLE_TEST = /(^|[^a-z])(tests?|testing|specs?|pytest|unittest|nose2?|vitest|jest|mocha|ava|tap|tox|nox|playwright|cypress|karma|jasmine)([^a-z]|$)/i;

/** Classifies one segment of a shell command. */
export function classifySegment(text: string, dialect: Dialect, scripts: Scripts): SegmentKind {
  const w = commandWords(text, dialect);
  if (!w || w.length === 0 || /\$\(|`|\$\{/.test(text.replace(/'[^']*'/g, ''))) {
    // Command substitution or unreadable quoting: its effect is opaque.
    return POSSIBLE_TEST.test(text) ? { kind: 'possible_test' } : { kind: 'mutating' };
  }
  const p = programName(w[0]!);
  if ((p === 'cd' || p === 'pushd' || p === 'set-location' || p === 'sl' || p === 'chdir') && w.length === 2) return { kind: 'cd', dir: w[1]! };

  const direct = directRunner(w);
  if (direct) {
    if (direct.runner === 'vitest' && ['list', 'bench', 'init'].includes(direct.args[0] ?? '')) return { kind: 'readonly' };
    if (direct.runner === 'pytest' && direct.args.some((a) => a === '--co' || a === '--collect-only' || a === '--help' || a === '--version' || a === '--fixtures' || a === '--markers')) return { kind: 'readonly' };
    if ((direct.runner === 'vitest' || direct.runner === 'jest') && direct.args.some((a) => a === '--version' || a === '--help' || a === '--listTests')) return { kind: 'readonly' };
    return { kind: 'test', framework: direct.runner, ...selectionFor(direct.runner, direct.args) };
  }

  const inv = scriptInvocation(w);
  if (inv) {
    const resolved = scripts ? scriptRunner(scripts, inv.script) : { runner: null, known: false };
    const isTest = inv.script === 'test' || resolved.known;
    if (isTest) {
      const framework: Framework = resolved.runner ?? 'unknown';
      if (inv.opaqueFlags.length) return { kind: 'test', framework, selection: 'unknown', filter: inv.opaqueFlags.join(' ') };
      if (inv.forwarded.length === 0) return { kind: 'test', framework, selection: 'full', filter: null };
      if (!resolved.runner) return { kind: 'test', framework, selection: 'unknown', filter: inv.forwarded.join(' ') };
      return { kind: 'test', framework, ...selectionFor(resolved.runner, inv.forwarded) };
    }
    return POSSIBLE_TEST.test(inv.script) ? { kind: 'possible_test' } : { kind: 'mutating' };
  }

  if (redirects(text).some((r) => !isNullDevice(r.target))) return { kind: 'mutating' };
  if (isReadonly(w)) return { kind: 'readonly' };
  if (/^(rm|del|erase|rmdir|rd|mv|move|cp|copy|touch|mkdir|md|ln|chmod|chown|sed|perl|tee|truncate|dd|patch|install|unzip|tar|git|remove-item|ri|move-item|mi|copy-item|cpi|rename-item|rni|set-content|sc|add-content|ac|out-file|new-item|ni|clear-content)$/.test(p)) {
    return { kind: 'mutating' };
  }
  return POSSIBLE_TEST.test(text) ? { kind: 'possible_test' } : { kind: 'mutating' };
}

// ---------------------------------------------------------------------------
// Exit status of one segment, from the exit status of the whole command

/**
 * The exit code of segment `index` when the whole command exited `whole`, or
 * null when it cannot be known: behind a pipe, or where `&&`/`||`/`;` leave
 * open whether it ran or whose status the command returned.
 */
export function segmentExit(segs: Segment[], index: number, whole: number | null): number | null {
  return segmentStatus(segs, index, whole).exit;
}

/** The exit code of a segment and, when it is unknown, why (see Run.exit_unknown). */
export function segmentStatus(segs: Segment[], index: number, whole: number | null): { exit: number | null; unknown: ExitUnknownReason | null } {
  const unknown = (reason: ExitUnknownReason): { exit: null; unknown: ExitUnknownReason } => ({ exit: null, unknown: reason });
  const pipefail = segs.slice(0, index).some((s) => /\bpipefail\b/.test(s.text));
  // The pipeline around the segment: [start, end].
  let start = index;
  while (segs[start]!.before === '|') start--;
  let end = index;
  while (segs[end]!.after === '|') end++;
  const after = segs[end]!.after;
  if (after === '&') return unknown('background');
  if (whole === null) return unknown('no_result');
  // Without pipefail a pipeline returns its last command's status.
  if (end !== index && !pipefail) return unknown('pipe');
  const before = segs[start]!.before;
  const alwaysRuns = before === null || before === ';' || before === '\n' || before === '&';
  let status: number;
  if (after === null) {
    // The last pipeline: the command's status is its status, if it ran.
    if (alwaysRuns) status = whole;
    else if (before === '&&' && whole === 0) status = 0;
    else return unknown('chain');
  } else {
    // Followed by more: only an unbroken `&&` chain to the end that succeeded says anything.
    if (!(alwaysRuns || before === '&&') || whole !== 0 || !allAfter(segs, end, '&&')) return unknown('chain');
    status = 0;
  }
  if (end === index || status === 0) return { exit: end === index ? status : 0, unknown: null };
  return unknown('pipe'); // pipefail: the pipeline failed, but not necessarily here
}

function allAfter(segs: Segment[], index: number, op: '&&'): boolean {
  for (let j = index; j < segs.length - 1; j++) if (segs[j]!.after !== op) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Runner summaries

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

type Words = Record<string, keyof RunSummary | 'partial' | null>;
type Counted = RunSummary & { total: number };

/** Counts by word; `total` is the sum of every count, to check against the total the runner prints. */
function counts(parts: string, map: Words): Counted | null {
  const out: Counted = { passed: 0, failed: 0, skipped: 0, total: 0 };
  for (const part of parts.split(/\s*[|,]\s*/)) {
    const m = /^(\d+)\s+([a-z]+)$/.exec(part.trim());
    if (!m) return null;
    if (!(m[2]! in map)) return null;
    const key = map[m[2]!];
    if (key === 'partial') {
      if (Number(m[1]) > 0) out.partial = true;
      continue;
    }
    if (key === 'passed' || key === 'failed' || key === 'skipped') out[key] += Number(m[1]);
    out.total += Number(m[1]);
  }
  return out;
}
const summaryOf = ({ total: _, ...s }: Counted): RunSummary => s;

const VITEST_WORDS: Words = nameTable('VITEST_WORDS', { passed: 'passed', failed: 'failed', skipped: 'skipped', todo: 'skipped', expected: 'passed' });
const JEST_WORDS: Words = nameTable('JEST_WORDS', { passed: 'passed', failed: 'failed', skipped: 'skipped', todo: 'skipped', pending: 'skipped' });
const PYTEST_WORDS: Words = nameTable('PYTEST_WORDS', {
  passed: 'passed', failed: 'failed', error: 'failed', errors: 'failed', skipped: 'skipped', xfailed: 'skipped',
  xpassed: 'passed', deselected: 'partial', warning: null, warnings: null, rerun: null, subtests: null,
});

/**
 * The summary line(s) of a test runner's output, whole lines only (a filter
 * may drop lines, never alter them). Null when there is none, more than one
 * (two runs in one output cannot be told apart), or it is not coherent (its
 * counts do not add up to the total the runner prints). `partial`: the
 * summary itself shows that not every test was selected (pytest's
 * "deselected", "no tests ran").
 */
export function parseSummary(rawOutput: string, framework: Framework): { framework: Framework; summary: RunSummary } | null {
  const output = rawOutput.replace(ANSI, '').replace(/\r/g, '');
  const found: { framework: Framework; summary: RunSummary }[] = [];
  const tryVitest = (): void => {
    const tests = [...output.matchAll(/^\s*Tests\s{2,}(.+?)\s+\((\d+)\)\s*$/gm)];
    const files = [...output.matchAll(/^\s*Test Files\s{2,}(.+?)\s+\((\d+)\)\s*$/gm)];
    if (tests.length > 1 || files.length > 1 || files.length === 0) return;
    const s = tests[0] ? counts(tests[0][1]!, VITEST_WORDS) : { passed: 0, failed: 0, skipped: 0, total: 0 };
    const f = counts(files[0]![1]!, VITEST_WORDS);
    if (!s || !f) return;
    // Coherent: each line's counts add up to the total in its parentheses.
    if ((tests[0] && s.total !== Number(tests[0][2])) || f.total !== Number(files[0]![2])) return;
    const errors = /^\s*Errors\s{2,}(\d+)\s+errors?\b/m.exec(output);
    // A test file that fails to load has no tests to count; count it as a failure.
    found.push({ framework: 'vitest', summary: { ...summaryOf(s), failed: Math.max(s.failed, f.failed) + (errors ? Number(errors[1]) : 0) } });
  };
  const tryJest = (): void => {
    const tests = [...output.matchAll(/^Tests:\s+(.+?),\s+(\d+) total\s*$/gm)];
    if (tests.length !== 1) return;
    const s = counts(tests[0]![1]!, JEST_WORDS);
    // Coherent: the counts add up to the total.
    if (!s || s.total !== Number(tests[0]![2])) return;
    const suites = /^Test Suites:\s+(\d+) failed/m.exec(output);
    found.push({ framework: 'jest', summary: { ...summaryOf(s), failed: Math.max(s.failed, suites ? Number(suites[1]) : 0) } });
  };
  const tryPytest = (): void => {
    const lines = [...output.matchAll(/^=*\s*((?:\d+ [a-z]+(?:, )?)+) in [\d.]+s(?: \([^)]*\))?\s*=*\s*$/gm)];
    const none = [...output.matchAll(/^=*\s*no tests ran in [\d.]+s\s*=*\s*$/gm)];
    if (lines.length + none.length !== 1) return;
    // "no tests ran": nothing was selected.
    const s: Counted | null = lines[0] ? counts(lines[0][1]!, PYTEST_WORDS) : { passed: 0, failed: 0, skipped: 0, total: 0, partial: true };
    if (s) found.push({ framework: 'pytest', summary: summaryOf(s) });
  };
  if (framework === 'vitest') tryVitest();
  else if (framework === 'jest') tryJest();
  else if (framework === 'pytest') tryPytest();
  else if (framework === 'unknown') {
    tryVitest();
    tryJest();
    tryPytest();
  }
  return found.length === 1 ? found[0]! : null;
}
