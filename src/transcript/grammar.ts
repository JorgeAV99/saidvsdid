// Certainty only inside a closed grammar.
//
// A shell call places a test run in the repository only when the WHOLE call
// has this form:
//
//   [cd <literal path> &&] [VAR=value ...] <runner> <args> [2>&1] [| tail|head|grep|tee ...]
//
// - <literal path>: no variable, `~`, glob, `$( )` or backquote;
// - <runner>: a recognised test command (npm/pnpm/yarn/bun test or a script,
//   npx/vitest/jest, pytest/py.test/python -m pytest, playwright test);
// - <args>: flags from the runner's allow-list below, and positional paths
//   (placed in the repository by src/location.ts, checked by the caller).
//   Any other flag (--prefix, --rootdir, -C, --config, --root, --dir, -c, an
//   unknown one) is outside;
// - anything else in the call (`;`, `||`, another `&&`, subshells, pushd/popd,
//   conditionals, redirections other than 2>&1, more than one runner) is
//   outside.
//
// What is outside is not interpreted: its runs are unplaced (their result is
// unknown). The grammar is widened only with data and a test against a real
// shell (test/shell-cwd-real.test.ts). It is read for the shells that test
// runs — bash, and PowerShell (pwsh 7 and Windows PowerShell 5.1), whose
// quotes, escapes (a backquote; before a letter it is a special character),
// typographic quotes, `@` and `,` differ — and for no other: cmd.exe is
// outside.
import { programName, segments, words, type Dialect } from './shell.js';

export type CallShape =
  /** One runner invocation in the grammar. `cd`: the literal directory it starts in, if any. */
  | { kind: 'run'; cd: string | null; positionals: string[] }
  /** The whole call is `cd <literal path>`. */
  | { kind: 'cd'; dir: string }
  /** Anything else. `movesShell`: it may leave the shell in another directory (cd, pushd, popd, source, eval…). */
  | { kind: 'other'; movesShell: boolean };

/** Characters that make a call more than literal words, outside quotes. */
const UNSAFE_POSIX = /[$`(){}<>;*?[\]!#~\n\r]/;

/**
 * Whether the call, with the recorder's markers (`<REPO>`) and the one
 * redirection the grammar allows (`2>&1`) set aside, holds only literal
 * words joined by `&&` and `|`: nothing outside quotes but words, and no
 * expansion inside double quotes. Quotes are read as the shell reads them:
 * single quotes are literal; inside double quotes `$` and a backquote expand,
 * and an escape (`\` in POSIX shells, a backquote in PowerShell) makes the next
 * character literal (`"a\|b"`, `"say \"hi\""`, `"\$HOME"`).
 */
function literalOnly(text: string, dialect: Dialect): boolean {
  const t = text.replace(/<[A-Z][A-Z_]*>/g, 'M').replace(/(^|\s)2>&1(?=\s|$|\|)/g, '$1');
  // PowerShell reads typographic quotes as quotes and typographic dashes as `-`.
  if (dialect === 'powershell' && /[‘’‚‛“”„–—―]/.test(t)) return false;
  const escape = dialect === 'posix' ? '\\' : dialect === 'powershell' ? '`' : null;
  let quote: string | null = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quote === "'") {
      if (c === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      // In PowerShell a backquote before a letter or a digit is a special character (`n, `r, `t, `0, `u{…}).
      if (c === escape && dialect === 'powershell' && /[A-Za-z0-9]/.test(t[i + 1] ?? '')) return false;
      if (c === escape && i + 1 < t.length) i++;
      else if (c === '"') quote = null;
      else if (c === '$' || c === '`' || (dialect === 'cmd' && c === '%')) return false;
      continue;
    }
    if (c === "'" && dialect !== 'cmd') {
      quote = c;
      continue;
    }
    if (c === '"') {
      quote = c;
      continue;
    }
    // Outside quotes, a POSIX `\` makes the next character literal (but not a line continuation).
    if (c === '\\' && dialect === 'posix') {
      if (i + 1 >= t.length || t[i + 1] === '\n' || t[i + 1] === '\r') return false;
      i++;
      continue;
    }
    if (UNSAFE_POSIX.test(c)) return false;
    if (dialect === 'cmd' && c === '%') return false;
    // PowerShell: `@` splats or builds an array, `,` builds an array.
    if (dialect === 'powershell' && (c === '@' || c === ',')) return false;
    // A single `&` (background, PowerShell's call operator) or `|` (only `|` between stages, not `||`).
    if (c === '&') {
      if (t[i + 1] !== '&') return false;
      i++;
    } else if (c === '|' && t[i + 1] === '|') return false;
  }
  return quote === null;
}

/** Words that may leave the shell in another directory. */
const MOVES_SHELL = new Set(['cd', 'chdir', 'pushd', 'popd', 'source', '.', 'eval', 'exec', 'set-location', 'sl', 'push-location', 'pop-location']);

const CD = new Set(['cd', 'chdir', 'set-location', 'sl']);
/**
 * Variables a `VAR=value` prefix may set: they change the output's colours or
 * the CI mode, never which tests run (PYTEST_ADDOPTS, VITEST_*, NODE_OPTIONS
 * do). Widened only with data: in the local Claude Code and Codex history,
 * the prefixes before a test runner are CI (176) and FORCE_COLOR (4); the
 * others are PYTEST_ADDOPTS, VITEST_* and NODE_OPTIONS (review repros only).
 */
const INNOCUOUS_ENV = new Set(['CI', 'FORCE_COLOR']);

/**
 * An output filter that reads only the pipe and drops whole lines, never
 * alters them: `grep` with a pattern and line-selecting flags (no file, no
 * `-o`, `-c`, `-n`…), `head`/`tail` with a line count only, `tee` (it reads
 * the pipe; its arguments are files it writes).
 */
function pipeOnlyFilter(w: readonly string[]): boolean {
  const p = programName(w[0] ?? '');
  const args = w.slice(1);
  if (p === 'tee') return args.every((a) => a === '-a' || !a.startsWith('-'));
  if (p === 'head' || p === 'tail') {
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (/^-\d+$/.test(a) || /^-n[+]?\d+$/.test(a) || /^--lines=[+]?\d+$/.test(a)) continue;
      if (a === '-n' && /^[+]?\d+$/.test(args[i + 1] ?? '')) {
        i++;
        continue;
      }
      return false;
    }
    return true;
  }
  if (p === 'grep') {
    let pattern = 0;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (/^-[EFivwx]+$/.test(a) || /^--color(=\w+)?$/.test(a)) continue;
      if (/^-[ABCm]$/.test(a) && /^\d+$/.test(args[i + 1] ?? '')) {
        i++;
        continue;
      }
      if (/^-[ABCm]\d+$/.test(a)) continue;
      if (a === '-e' && i + 1 < args.length) {
        pattern++;
        i++;
        continue;
      }
      if (a.startsWith('-')) return false;
      pattern++;
    }
    // Exactly one pattern; anything more would be a file to read.
    return pattern === 1;
  }
  return false;
}

// Flags per runner: without a value, and with a value (the next word, or `--flag=value`).
interface Flags {
  plain: ReadonlySet<string>;
  valued: ReadonlySet<string>;
  /** Short flags that may be bundled (`-xq`). */
  bundled?: string;
}
const set = (...xs: string[]): ReadonlySet<string> => new Set(xs);
const RUNNER_FLAGS: Record<'vitest' | 'jest' | 'pytest' | 'playwright', Flags> = {
  vitest: {
    plain: set('--run', '--silent', '--passWithNoTests', '--no-color', '--color', '--coverage', '--no-coverage', '--globals', '--no-file-parallelism', '--hideSkippedTests'),
    valued: set('-t', '--testNamePattern', '--reporter', '--project', '--bail', '--shard', '--maxWorkers', '--minWorkers', '--pool', '--retry', '--testTimeout', '--environment'),
  },
  jest: {
    plain: set('--ci', '--silent', '--verbose', '--runInBand', '-i', '--coverage', '--passWithNoTests', '--no-cache', '--colors', '--detectOpenHandles', '--forceExit', '--bail', '--watchAll=false', '--no-watchman'),
    valued: set('-t', '--testNamePattern', '--reporters', '--maxWorkers', '-w', '--testTimeout', '--shard', '--selectProjects'),
  },
  pytest: {
    plain: set('-q', '-v', '-vv', '-vvv', '-x', '-s', '-l', '--lf', '--ff', '--last-failed', '--failed-first', '--exitfirst', '--no-header', '--disable-warnings', '--showlocals', '--strict-markers', '-ra', '-rA', '-rf', '-rs', '-rx', '--quiet', '--verbose'),
    valued: set('-k', '-m', '--tb', '--maxfail', '--durations', '-n', '-W'),
    bundled: 'qvxsl',
  },
  playwright: {
    plain: set('--headed', '--forbid-only', '--pass-with-no-tests', '-x', '--quiet'),
    valued: set('--project', '-g', '--grep', '--grep-invert', '--reporter', '-j', '--workers', '--retries', '--repeat-each', '--shard', '--timeout'),
  },
};
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const QUIET_NPM = set('--silent', '-s', '--if-present', '-q', '--quiet', '--no-color');
const PYTHONS = /^(python|python3(\.\d+)?|py)$/;

/** Checks `args` against a runner's flags; the positionals, or null when a word is outside. */
function runnerArgs(runner: keyof typeof RUNNER_FLAGS, args: readonly string[]): string[] | null {
  const f = RUNNER_FLAGS[runner];
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('-') || a === '-') {
      positionals.push(a);
      continue;
    }
    if (a === '--') return null;
    const eq = a.indexOf('=');
    const name = eq === -1 ? a : a.slice(0, eq);
    if (f.plain.has(a)) continue;
    if (f.valued.has(name)) {
      if (eq === -1) {
        if (i + 1 >= args.length) return null;
        i++;
      }
      continue;
    }
    if (f.bundled && /^-[a-z]+$/.test(a) && [...a.slice(1)].every((c) => f.bundled!.includes(c))) continue;
    return null;
  }
  return positionals;
}

/** A runner invocation in the grammar: its positionals, or null. `scriptRunner` names the runner a package script calls. */
function runnerInvocation(w: readonly string[], scriptRunner: (script: string) => keyof typeof RUNNER_FLAGS | null): string[] | null {
  const p = programName(w[0] ?? '');
  // npm test / npm run <script> [-- args], with only quiet flags of the package manager.
  if (PACKAGE_MANAGERS.has(p)) {
    let i = 1;
    while (QUIET_NPM.has(w[i] ?? '')) i++;
    let script: string | undefined;
    if (w[i] === 'test' || w[i] === 't' || w[i] === 'tst') script = 'test';
    else if (w[i] === 'run' || w[i] === 'run-script') script = w[++i];
    if (!script || script.startsWith('-')) return null;
    const rest = w.slice(i + 1);
    const dd = rest.indexOf('--');
    // npm passes only what follows `--`; before it, only quiet flags.
    if ((dd === -1 ? rest : rest.slice(0, dd)).some((x) => !QUIET_NPM.has(x))) return null;
    if (dd === -1) return [];
    const runner = scriptRunner(script);
    return runner ? runnerArgs(runner, rest.slice(dd + 1)) : rest.length === dd + 1 ? [] : null;
  }
  let i = 0;
  if (['npx', 'pnpx', 'bunx'].includes(p)) {
    i = 1;
    while (w[i] === '-y' || w[i] === '--yes' || w[i] === '--no-install') i++;
  }
  const q = programName(w[i] ?? '');
  if (q === 'vitest') return runnerArgs('vitest', w.slice(i + (w[i + 1] === 'run' ? 2 : 1)));
  if (q === 'jest') return runnerArgs('jest', w.slice(i + 1));
  if (q === 'playwright' && w[i + 1] === 'test') return runnerArgs('playwright', w.slice(i + 2));
  if (q === 'pytest' || q === 'py.test') return runnerArgs('pytest', w.slice(i + 1));
  if (i === 0 && PYTHONS.test(q) && w[1] === '-m' && w[2] === 'pytest') return runnerArgs('pytest', w.slice(3));
  return null;
}

/**
 * The shape of a whole shell call (after its launcher is removed). Only
 * `run` and `cd` are certain; `other` is outside the grammar.
 */
export function callShape(inner: string, dialect: Dialect, scriptRunner: (script: string) => keyof typeof RUNNER_FLAGS | null = () => null): CallShape {
  const segs = segments(inner, dialect);
  const allWords = segs.map((s) => words(s.text.replace(/(^|\s)2>&1(?=\s|$)/g, '$1'), dialect === 'cmd' ? 'posix' : dialect));
  const movesShell = allWords.some((w) => w === null || w.some((x) => MOVES_SHELL.has(x.toLowerCase()))) || /[()`$]/.test(inner);
  const other: CallShape = { kind: 'other', movesShell };
  // Only shells a real-system oracle runs are read (bash, pwsh, Windows PowerShell:
  // test/shell-cwd-real.test.ts). cmd.exe has none: nothing it runs is placed.
  if (dialect === 'cmd') return { kind: 'other', movesShell: true };
  if (!literalOnly(inner, dialect) || segs.length === 0 || allWords.some((w) => w === null || w.length === 0)) return other;
  const ws = allWords as string[][];
  let k = 0;
  let cd: string | null = null;
  if (CD.has(ws[0]![0]!.toLowerCase())) {
    if (ws[0]!.length !== 2) return other;
    // PowerShell's Set-Location reads wildcards even in quotes (`'sub[1]'` is `sub1`): standalone or before a run.
    if (dialect === 'powershell' && /[[\]*?]/.test(ws[0]![1]!)) return other;
    if (segs.length === 1) return { kind: 'cd', dir: ws[0]![1]! };
    if (segs[0]!.after !== '&&') return other;
    cd = ws[0]![1]!;
    k = 1;
  }
  // The runner, with leading VAR=value assignments from the closed list of variables
  // that change no test selection. In PowerShell `VAR=v` is not an assignment.
  const runnerSeg = segs[k]!;
  if (k === 0 ? runnerSeg.before !== null : runnerSeg.before !== '&&') return other;
  let w = ws[k]!;
  while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]!)) {
    if (dialect !== 'posix' || !INNOCUOUS_ENV.has(w[0]!.slice(0, w[0]!.indexOf('=')))) return other;
    w = w.slice(1);
  }
  const positionals = runnerInvocation(w, scriptRunner);
  if (!positionals) return other;
  // Output filters only, joined by pipes, reading nothing but the pipe.
  for (let j = k + 1; j < segs.length; j++) {
    if (segs[j]!.before !== '|' || !pipeOnlyFilter(ws[j]!)) return other;
  }
  return { kind: 'run', cd, positionals };
}
