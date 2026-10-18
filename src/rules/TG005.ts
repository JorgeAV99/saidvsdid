// TG005: timeouts inflated, retries added, the suite's scope reduced.
//
// Scope. For every changed runner configuration (package.json `test` script
// and `jest` field, vitest/jest/playwright configs, pytest ini sources,
// conftest.py) the scope-relevant settings of both sides are compared. When a
// change adds an exclusion or changes what is included, the runner's
// selection is computed three times — at base, at base with only this file
// changed, and at head — to estimate which test files (or, for pytest
// -k/--deselect, which tests) that ran at base it likely leaves out.
// V0: every scope finding is a WARN, never a FAIL (the model has been wrong on
// real runners; see docs/rules.md). The estimate only makes the WARN specific.
// Config changes TG005 does not report are covered by configNet (net.ts).
//
// Timeouts and retries never change which tests run, so they are WARN only:
// a timeout raised to at least 3x its previous value (or the runner default),
// and any new or larger retry count.
import { optionArgs, optionList, parsePytestArgs, PYTEST_CONFIG_FILES, pytestConfigFor, readConftest, readPytestConfig } from '../config/pytest.js';
import { readJsConfig } from '../config/js.js';
import { inFixtureDir, projectsView } from '../config/testscope.js';
import { parseJsonValue } from '../config/json.js';
import { analyseTestScript, parseJestArgs, parseVitestArgs } from '../config/scripts.js';
import { canonical, prop, stringList, type ConfigValue } from '../config/values.js';
import type { Knob, TestCase, TestFile } from '../parse/index.js';
import {
  below,
  jestSelection,
  join,
  JEST_CONFIGS,
  PLAYWRIGHT_CONFIGS,
  pytestConfigAt,
  pytestSelection,
  VITEST_CONFIGS,
  vitestSelection,
  type Runner,
  type Selection,
  type View,
} from './scope.js';
import type { CheckContext, Finding, Rule } from './types.js';
import { runningTests } from './TG002.js';
import { hiddenLevel, listNames, quote } from './util.js';
import { nameTable } from '../util/names.js';

// ---------------------------------------------------------------------------
// Facts: what one side of one config file says about scope, timeouts, retries

interface Fact {
  runner: Runner;
  /** `exclude` narrows (any new one warns); `include` redefines the selection (only a provable loss matters). */
  type: 'exclude' | 'include';
  /** Identity for comparing base and head. */
  key: string;
  label: string;
  line: number;
}

interface ConfigKnob {
  runner: Runner;
  kind: 'timeout' | 'retry';
  key: string;
  label: string;
  value: number | null;
  /** The written value when it is not a literal number. */
  text: string;
  /** What an absent setting means; null when absence means "no limit" (pytest-timeout). */
  fallback: number | null;
  unit: string;
  line: number;
}

interface Facts {
  facts: Fact[];
  knobs: ConfigKnob[];
}

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
const dirname = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/**
 * Whether the net watches `path`: an explicit list of names, compared without case on every platform (on a
 * case-insensitive file system `PYTEST.INI` is pytest.ini). Its contents never decide it.
 */
export function isConfigPath(path: string): boolean {
  const b = basename(path).toLowerCase();
  return (
    // A package.json inside a test fixture directory is test data (src/config/testscope.ts).
    (b === 'package.json' && !inFixtureDir(path)) ||
    b === 'conftest.py' ||
    VITEST_CONFIGS.includes(b) ||
    JEST_CONFIGS.includes(b) ||
    PLAYWRIGHT_CONFIGS.includes(b) ||
    (PYTEST_CONFIG_FILES as readonly string[]).includes(b) ||
    NET_ONLY_CONFIG.test(b)
  );
}

/**
 * Runner configuration TG005 does not read, watched by the config net only (any change of bytes, a WARN):
 * vitest workspaces, configs named for a vitest project (`vitest.<name>.config.*`, what `projects` points at),
 * and vite configs (vitest reads its options from them), whatever they contain.
 */
const NET_ONLY_CONFIG = /^(?:vitest\.workspace\.(?:[cm]?[jt]s|json)|vitest\.[\w-]+\.config\.[cm]?[jt]s|vite\.(?:[\w-]+\.)?config\.[cm]?[jt]s)$/;

/** Runner defaults, so that writing a default explicitly is not a change. */
const DEFAULT_LISTS: Record<string, string[]> = nameTable('DEFAULT_LISTS', {
  'vitest:include': ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  'vitest:exclude': ['**/node_modules/**', '**/.git/**'],
  'jest:testMatch': ['**/__tests__/**/*.?([mc])[jt]s?(x)', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)'],
  'jest:testPathIgnorePatterns': ['/node_modules/'],
});

function listFacts(runner: Runner, type: Fact['type'], key: string, v: ConfigValue | undefined, label: string): Fact[] {
  const fallback = DEFAULT_LISTS[`${runner}:${key}`];
  if (!v && fallback) v = { t: 'arr', items: fallback.map((x) => ({ t: 'str', v: x, line: 1 })), line: 1 };
  if (!v) return [];
  const list = stringList(v);
  if (!list) return [{ runner, type, key: `${key}=${canonical(v)}`, label: `\`${label}\` (not a literal list)`, line: v.line }];
  if (type === 'include') return [{ runner, type, key: `${key}=${JSON.stringify(list)}`, label: `\`${label}: ${JSON.stringify(list)}\``, line: v.line }];
  return list.map((item) => ({ runner, type, key: `${key}:${item}`, label: `\`${label}\` entry \`${item}\``, line: v.line }));
}

function numKnob(runner: Runner, kind: ConfigKnob['kind'], key: string, label: string, v: ConfigValue | undefined, fallback: number | null, unit: string): ConfigKnob[] {
  if (!v) return [];
  return [{ runner, kind, key, label, value: v.t === 'num' ? v.v : null, text: v.t === 'unknown' ? v.text : canonical(v), fallback, unit, line: v.line }];
}

const EMPTY: ConfigValue = { t: 'obj', props: new Map(), line: 1, open: false };

/** Facts of one side of a config file; an absent file means the runner defaults. */
async function factsOf(path: string, text: string | null): Promise<Facts> {
  const out: Facts = { facts: [], knobs: [] };
  const b = basename(path);
  if (VITEST_CONFIGS.includes(b)) {
    const config = text === null ? EMPTY : await readJsConfig(path, text);
    if (config.t !== 'obj') {
      out.facts.push({ runner: 'vitest', type: 'include', key: `unreadable:${canonical(config)}`, label: 'the configuration (not a literal object)', line: config.line });
      return out;
    }
    const test = prop(config, 'test');
    out.facts.push(...listFacts('vitest', 'include', 'include', prop(test, 'include'), 'include'));
    out.facts.push(...listFacts('vitest', 'exclude', 'exclude', prop(test, 'exclude'), 'exclude'));
    for (const key of ['root', 'dir', 'projects', 'workspace']) {
      const v = prop(test, key) ?? prop(config, key);
      // An inline project's module resolution selects nothing (src/config/testscope.ts): compared as it selects tests.
      if (v) out.facts.push({ runner: 'vitest', type: 'include', key: `${key}=${key === 'projects' || key === 'workspace' ? projectsView(v) : canonical(v)}`, label: `\`${key}\``, line: v.line });
    }
    const pwnt = prop(test, 'passWithNoTests');
    if (pwnt && !(pwnt.t === 'bool' && !pwnt.v)) out.facts.push({ runner: 'vitest', type: 'exclude', key: 'passWithNoTests', label: '`passWithNoTests`', line: pwnt.line });
    out.knobs.push(...numKnob('vitest', 'timeout', 'testTimeout', '`testTimeout`', prop(test, 'testTimeout'), 5000, 'ms'));
    out.knobs.push(...numKnob('vitest', 'retry', 'retry', '`retry`', prop(test, 'retry'), 0, ''));
    return out;
  }
  if (JEST_CONFIGS.includes(b)) {
    const config = text === null ? EMPTY : b.endsWith('.json') ? (parseJsonValue(text) ?? { t: 'unknown' as const, text: 'invalid JSON', line: 1 }) : await readJsConfig(path, text);
    out.facts.push(...jestFacts(config));
    out.knobs.push(...numKnob('jest', 'timeout', 'testTimeout', '`testTimeout`', prop(config, 'testTimeout'), 5000, 'ms'));
    return out;
  }
  if (PLAYWRIGHT_CONFIGS.includes(b)) {
    const config = text === null ? EMPTY : await readJsConfig(path, text);
    for (const key of ['testDir', 'testMatch', 'testIgnore', 'grep', 'grepInvert', 'projects']) {
      const v = prop(config, key);
      // Playwright selection is not evaluated: any change warns.
      if (v) out.facts.push({ runner: 'playwright', type: 'exclude', key: `${key}=${canonical(v)}`, label: `\`${key}\``, line: v.line });
    }
    out.knobs.push(...numKnob('playwright', 'timeout', 'timeout', '`timeout`', prop(config, 'timeout'), 30000, 'ms'));
    out.knobs.push(...numKnob('playwright', 'retry', 'retries', '`retries`', prop(config, 'retries'), 0, ''));
    return out;
  }
  if (b === 'package.json') {
    const pkg = text === null ? EMPTY : parseJsonValue(text);
    if (!pkg) return out;
    out.facts.push(...jestFacts(prop(pkg, 'jest') ?? EMPTY));
    const jestField = prop(pkg, 'jest');
    out.knobs.push(...numKnob('jest', 'timeout', 'testTimeout', '`jest.testTimeout`', prop(jestField, 'testTimeout'), 5000, 'ms'));
    const script = prop(prop(pkg, 'scripts'), 'test');
    if (script?.t === 'str') {
      const at = script.line;
      const analysis = analyseTestScript(script.v);
      for (const run of analysis.runs) {
        if (run.runner === 'vitest') {
          const a = parseVitestArgs(run.args);
          for (const f of a.filters) out.facts.push({ runner: 'vitest', type: 'exclude', key: `filter:${f}`, label: `file filter \`${f}\``, line: at });
          for (const e of a.exclude) out.facts.push({ runner: 'vitest', type: 'exclude', key: `exclude:${e}`, label: `\`--exclude ${e}\``, line: at });
          for (const o of a.opaque) out.facts.push({ runner: 'vitest', type: 'exclude', key: `opaque:${o}`, label: `\`${o}\``, line: at });
          if (a.passWithNoTests) out.facts.push({ runner: 'vitest', type: 'exclude', key: 'passWithNoTests', label: '`--passWithNoTests`', line: at });
          if (a.testTimeout !== null) out.knobs.push({ runner: 'vitest', kind: 'timeout', key: 'cli:testTimeout', label: '`--testTimeout`', value: a.testTimeout, text: String(a.testTimeout), fallback: 5000, unit: 'ms', line: at });
          if (a.retry !== null) out.knobs.push({ runner: 'vitest', kind: 'retry', key: 'cli:retry', label: '`--retry`', value: a.retry, text: String(a.retry), fallback: 0, unit: '', line: at });
        } else if (run.runner === 'jest') {
          const a = parseJestArgs(run.args);
          for (const i of a.ignore) out.facts.push({ runner: 'jest', type: 'exclude', key: `testPathIgnorePatterns:${i}`, label: `\`--testPathIgnorePatterns ${i}\``, line: at });
          for (const o of a.opaque) out.facts.push({ runner: 'jest', type: 'exclude', key: `opaque:${o}`, label: `\`${o}\``, line: at });
          if (a.passWithNoTests) out.facts.push({ runner: 'jest', type: 'exclude', key: 'passWithNoTests', label: '`--passWithNoTests`', line: at });
          if (a.testTimeout !== null) out.knobs.push({ runner: 'jest', kind: 'timeout', key: 'cli:testTimeout', label: '`--testTimeout`', value: a.testTimeout, text: String(a.testTimeout), fallback: 5000, unit: 'ms', line: at });
        } else if (run.runner === 'pytest') {
          pytestArgFacts(out, run.args, at, 'script ');
        }
      }
      for (const o of analysis.opaque) out.facts.push({ runner: 'vitest', type: 'include', key: `script:${o}`, label: `\`${o}\` in the test script`, line: at });
    }
    return out;
  }
  if (b === 'conftest.py') {
    if (text === null) return out;
    const c = await readConftest(path, text);
    for (const [key, list] of [['collect_ignore', c.collectIgnore], ['collect_ignore_glob', c.collectIgnoreGlob]] as const) {
      if (list === null) out.facts.push({ runner: 'pytest', type: 'exclude', key: `${key}:unreadable`, label: `\`${key}\` (computed)`, line: c.line });
      else for (const item of list) out.facts.push({ runner: 'pytest', type: 'exclude', key: `${key}:${item}`, label: `\`${key}\` entry \`${item}\``, line: c.line });
    }
    return out;
  }
  const config = text === null ? null : readPytestConfig(path, text);
  if (!config) return out;
  const addopts = config.options.get('addopts');
  if (addopts) {
    const words = optionArgs(addopts);
    if (words === null) out.facts.push({ runner: 'pytest', type: 'exclude', key: 'addopts:unreadable', label: '`addopts`', line: addopts.line });
    else pytestArgFacts(out, words, addopts.line, '');
  }
  for (const key of ['testpaths', 'python_files']) {
    const o = config.options.get(key);
    if (o) out.facts.push({ runner: 'pytest', type: 'include', key: `${key}=${JSON.stringify(optionList(o) ?? o.value)}`, label: `\`${key}\``, line: o.line });
  }
  const norecurse = config.options.get('norecursedirs');
  const dirs = norecurse ? (optionList(norecurse) ?? ['(unreadable)']) : ['*.egg', '.*', '_darcs', 'build', 'CVS', 'dist', 'node_modules', 'venv', '{arch}'];
  for (const d of dirs) out.facts.push({ runner: 'pytest', type: 'exclude', key: `norecursedirs:${d}`, label: `\`norecursedirs\` entry \`${d}\``, line: norecurse?.line ?? 1 });
  const timeout = config.options.get('timeout');
  if (timeout) out.knobs.push({ runner: 'pytest', kind: 'timeout', key: 'timeout', label: '`timeout`', value: numberOf(timeout.value), text: String(timeout.value), fallback: null, unit: 's', line: timeout.line });
  const reruns = config.options.get('reruns');
  if (reruns) out.knobs.push({ runner: 'pytest', kind: 'retry', key: 'reruns', label: '`reruns`', value: numberOf(reruns.value), text: String(reruns.value), fallback: 0, unit: '', line: reruns.line });
  return out;
}

function numberOf(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

function jestFacts(config: ConfigValue | undefined): Fact[] {
  if (!config) return [];
  if (config.t !== 'obj') return [{ runner: 'jest', type: 'include', key: `unreadable:${canonical(config)}`, label: 'the jest configuration (not a literal object)', line: config.line }];
  const out: Fact[] = [];
  for (const key of ['testMatch', 'testRegex', 'roots', 'projects', 'rootDir', 'preset']) out.push(...listFacts('jest', 'include', key, prop(config, key), key));
  out.push(...listFacts('jest', 'exclude', 'testPathIgnorePatterns', prop(config, 'testPathIgnorePatterns'), 'testPathIgnorePatterns'));
  const pwnt = prop(config, 'passWithNoTests');
  if (pwnt && !(pwnt.t === 'bool' && !pwnt.v)) out.push({ runner: 'jest', type: 'exclude', key: 'passWithNoTests', label: '`passWithNoTests`', line: pwnt.line });
  return out;
}

function pytestArgFacts(out: Facts, words: string[], line: number, where: string): void {
  const a = parsePytestArgs(words);
  const add = (key: string, label: string, type: Fact['type'] = 'exclude'): void => {
    out.facts.push({ runner: 'pytest', type, key, label, line });
  };
  if (a.k !== null) add(`k:${a.k}`, `\`-k ${JSON.stringify(a.k)}\``);
  if (a.m !== null) add(`m:${a.m}`, `\`-m ${JSON.stringify(a.m)}\``);
  for (const d of a.deselect) add(`deselect:${d}`, `\`--deselect ${d}\``);
  for (const i of a.ignore) add(`ignore:${i}`, `\`--ignore=${i}\``);
  for (const g of a.ignoreGlob) add(`ignore-glob:${g}`, `\`--ignore-glob=${g}\``);
  for (const u of a.unclassified) add(`opaque:${u}`, `\`${u}\``);
  if (a.paths.length > 0) add(`paths=${JSON.stringify(a.paths)}`, `${where}paths ${a.paths.map((p) => `\`${p}\``).join(' ')}`, 'include');
  if (a.reruns !== null) out.knobs.push({ runner: 'pytest', kind: 'retry', key: 'cli:reruns', label: '`--reruns`', value: a.reruns, text: String(a.reruns), fallback: 0, unit: '', line });
  if (a.timeout !== null) out.knobs.push({ runner: 'pytest', kind: 'timeout', key: 'cli:timeout', label: '`--timeout`', value: a.timeout, text: String(a.timeout), fallback: null, unit: 's', line });
}

// ---------------------------------------------------------------------------
// Views over the repository

function view(ctx: CheckContext, side: 'base' | 'head'): View | null {
  const files = ctx.repo.list(side);
  return files ? { files, read: (p) => ctx.repo.read(side, p) } : null;
}

/** Base, with one config file taken from head: isolates the effect of that file. */
function mixed(ctx: CheckContext, base: View, path: { basePath: string | null; headPath: string | null }): View {
  const headText = path.headPath ? ctx.repo.read('head', path.headPath) : null;
  const target = path.headPath ?? path.basePath!;
  return {
    files: path.headPath && !base.files.includes(path.headPath) ? [...base.files, path.headPath] : base.files,
    read: (p) => (p === target ? headText : p === path.basePath ? null : base.read(p)),
  };
}

async function select(runner: Runner, v: View, dir: string): Promise<Selection> {
  if (runner === 'vitest') return vitestSelection(v, dir);
  if (runner === 'jest') return jestSelection(v, dir);
  if (runner === 'pytest') return pytestSelection(v, dir);
  return { certain: false, reason: 'Playwright test selection is not evaluated' };
}

/** Whether `runner` is known to run this project at base. */
function inUseAtBase(runner: Runner, base: View, dir: string): boolean {
  const pkgText = base.read(join(dir, 'package.json'));
  const mentions = pkgText !== null && new RegExp(`\\b${runner}\\b`).test(pkgText);
  if (runner === 'vitest') return mentions || VITEST_CONFIGS.some((n) => base.read(join(dir, n)) !== null);
  if (runner === 'jest') return mentions || JEST_CONFIGS.some((n) => base.read(join(dir, n)) !== null);
  if (runner === 'pytest') return pytestConfigAt(base, dir) !== null || base.files.some((f) => below(dir, f) !== null && basename(f) === 'conftest.py');
  return mentions || PLAYWRIGHT_CONFIGS.some((n) => base.read(join(dir, n)) !== null);
}

/** The pytest rootdir for a changed pytest file: its own directory for an ini source, the nearest configured ancestor for a conftest. */
function pytestRoot(path: string, head: View | null, base: View | null): string {
  if (basename(path) !== 'conftest.py') return dirname(path);
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    if ((head && pytestConfigAt(head, dir)) || (base && pytestConfigAt(base, dir))) return dir;
    if (dir === '') return '';
  }
}

// ---------------------------------------------------------------------------

function headPathOf(ctx: CheckContext, basePath: string): string | null {
  const change = ctx.allChanges.find((c) => c.basePath === basePath);
  if (!change) return basePath;
  return change.headPath;
}

async function testsIn(ctx: CheckContext, side: 'base' | 'head', path: string): Promise<TestFile | null> {
  const f = await ctx.repo.parse(side, path);
  return f && !f.parseErrors && f.tests.length > 0 ? f : null;
}

interface Loss {
  files: string[];
  tests: string[];
  unsure: boolean;
  /** Excluded files or tests that did not run at base anyway (all skipped, focused away). */
  idle: string[];
}

/** Tests the extractor says ran at base: not disabled by any marker, not left out by a focus. */
function ranAtBase(file: TestFile): Set<TestCase> {
  return new Set([...runningTests(file.tests, file.language)].filter((t) => hiddenLevel(t) === 0));
}

async function lost(ctx: CheckContext, sb: Selection, sc: Selection, sh: Selection): Promise<Loss> {
  const out: Loss = { files: [], tests: [], unsure: false, idle: [] };
  if (!sb.certain || !sc.certain || !sh.certain) return out;
  for (const f of [...sb.files].sort()) {
    const h = headPathOf(ctx, f);
    if (h === null || !ctx.repo.list('head')?.includes(h)) continue; // deleted: TG001's business
    const base = await testsIn(ctx, 'base', f);
    const head = await testsIn(ctx, 'head', h);
    if (!base || !head) continue;
    const ran = ranAtBase(base);
    if (!sc.files.has(f)) {
      // Only tests that ran at base count as likely excluded; a file of skipped tests says so.
      if (!sh.files.has(h)) (ran.size > 0 ? out.files : out.idle).push(h);
      continue;
    }
    if (!sh.files.has(h) || (!sb.tests && !sc.tests && !sh.tests)) continue;
    for (const t of head.tests) {
      const bt = base.tests.find((x) => x.name === t.name);
      if (!bt) continue;
      const before = sb.tests ? sb.tests(f, bt) : true;
      const alone = sc.tests ? sc.tests(f, bt) : true;
      const after = sh.tests ? sh.tests(h, t) : true;
      if (before === true && alone === false && after === false) (ran.has(bt) ? out.tests : out.idle).push(`${h}::${t.name}`);
      else if (before !== false && (alone === null || after === null)) out.unsure = true;
    }
  }
  return out;
}

async function scopeFindings(ctx: CheckContext, change: { basePath: string | null; headPath: string | null }, bf: Facts, hf: Facts): Promise<Finding[]> {
  const path = change.headPath ?? change.basePath!;
  const baseView = view(ctx, 'base');
  const headView = view(ctx, 'head');
  const findings: Finding[] = [];
  const runners = [...new Set([...bf.facts, ...hf.facts].map((f) => f.runner))].sort();
  for (const runner of runners) {
    const before = new Set(bf.facts.filter((f) => f.runner === runner).map((f) => f.key));
    const beforeInclude = bf.facts.filter((f) => f.runner === runner && f.type === 'include').map((f) => f.key).sort();
    const afterInclude = hf.facts.filter((f) => f.runner === runner && f.type === 'include').map((f) => f.key).sort();
    const added = hf.facts.filter((f) => f.runner === runner && f.type === 'exclude' && !before.has(f.key));
    const included = hf.facts.filter((f) => f.runner === runner && f.type === 'include' && !before.has(f.key));
    const includeChanged = JSON.stringify(beforeInclude) !== JSON.stringify(afterInclude);
    if (added.length === 0 && !includeChanged) continue;
    const changed = [...added, ...included];
    const line = changed.length > 0 ? Math.min(...changed.map((f) => f.line)) : (hf.facts.find((f) => f.runner === runner)?.line ?? null);
    const what = changed.length > 0 ? changed.map((f) => f.label).join(', ') : `the ${runner} test selection`;
    const at = { rule: 'TG005' as const, file: path, side: change.headPath ? ('head' as const) : ('base' as const), line, test: null };

    const dir = runner === 'pytest' ? pytestRoot(path, headView, baseView) : dirname(path);
    let reason: string | null = null;
    let loss: Loss = { files: [], tests: [], unsure: false, idle: [] };
    if (!baseView || !headView) reason = 'the repository file listing is not available';
    else if (!inUseAtBase(runner, baseView, dir)) reason = `${runner} is not known to run this project at base`;
    else {
      const [sb, sc, sh] = await Promise.all([select(runner, baseView, dir), select(runner, mixed(ctx, baseView, change), dir), select(runner, headView, dir)]);
      const failed = [sb, sc, sh].find((s): s is Extract<Selection, { certain: false }> => !s.certain);
      if (failed) reason = failed.reason;
      else {
        loss = await lost(ctx, sb, sc, sh);
        if (loss.unsure) reason = 'some tests match the -k expression only through names we cannot see (parametrize ids, conftest marks)';
      }
    }
    if (loss.files.length > 0 || loss.tests.length > 0) {
      // V0: scope reductions never FAIL (docs/rules.md, TG005). The selection
      // model only makes the WARN specific.
      const parts: string[] = [];
      if (loss.files.length > 0) parts.push(`${loss.files.length} test file${loss.files.length === 1 ? '' : 's'} that ran at base: ${listNames(loss.files)}`);
      if (loss.tests.length > 0) parts.push(`${loss.tests.length} test${loss.tests.length === 1 ? '' : 's'} that ran at base: ${listNames(loss.tests)}`);
      findings.push({ ...at, severity: 'warn', message: `Test scope reduced by ${what}: likely excludes ${parts.join('; ')}`, tests: [...loss.files, ...loss.tests] });
    } else if (loss.idle.length > 0) {
      findings.push({
        ...at,
        severity: 'warn',
        message: `Test scope narrowed by ${what}: it leaves out ${listNames(loss.idle)}, whose tests did not run at base (skipped or focused away); review it`,
        tests: loss.idle,
      });
    } else if (added.length > 0) {
      const why = added.some((f) => f.key === 'passWithNoTests') && added.length === 1
        ? 'an empty test selection would now pass'
        : reason
          ? `its effect cannot be evaluated with certainty (${reason})`
          : 'no test that ran at base is excluded by it today';
      findings.push({ ...at, severity: 'warn', message: `Test scope narrowed by ${what}: ${why}` });
    } else if (reason) {
      findings.push({ ...at, severity: 'warn', message: `Test selection changed by ${what}; its effect cannot be evaluated with certainty (${reason})` });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Timeouts and retries

function describeValue(v: number, unit: string): string {
  return unit ? `${v} ${unit}` : String(v);
}

function knobFinding(kind: 'timeout' | 'retry', before: number | null, after: number | null, fromDefault: boolean, unit: string): string | null {
  if (after === null) return null;
  if (kind === 'retry') {
    const b = before ?? 0;
    if (after <= b) return null;
    return `retries raised from ${fromDefault ? `the default ${b}` : b} to ${after}: a failing test can now pass on a later attempt`;
  }
  if (before === null || before <= 0) return null;
  if (after === 0) return `timeout disabled (0) where it was ${fromDefault ? `the default ${describeValue(before, unit)}` : describeValue(before, unit)}`;
  if (after < before * 3) return null;
  return `timeout raised from ${fromDefault ? `the default ${describeValue(before, unit)}` : describeValue(before, unit)} to ${describeValue(after, unit)} (${Math.round((after / before) * 10) / 10}×)`;
}

function configKnobFindings(path: string, bf: Facts, hf: Facts): Finding[] {
  const out: Finding[] = [];
  for (const k of hf.knobs) {
    const b = bf.knobs.find((x) => x.key === k.key && x.runner === k.runner);
    if (k.value === null) {
      if (!b || b.text !== k.text) out.push({ rule: 'TG005', severity: 'warn', file: path, side: 'head', line: k.line, test: null, message: `${k.label}: set to \`${k.text}\`, which cannot be read` });
      continue;
    }
    const before = b ? b.value : k.fallback;
    const msg = knobFinding(k.kind, before, k.value, !b, k.unit);
    if (msg) out.push({ rule: 'TG005', severity: 'warn', file: path, side: 'head', line: k.line, test: null, message: `${k.label}: ${msg}` });
  }
  return out;
}

/**
 * Default timeout for a knob written in a test file with no counterpart at base; null when there is no limit
 * by default (pytest without pytest-timeout's `timeout`, node:test's Infinity): a timeout set there is a limit
 * where there was none, never raised from a default.
 */
function knobDefault(k: Knob, file: TestFile, pytestTimeout: number | null): number | null {
  if (k.kind !== 'timeout') return 0;
  if (file.language === 'python') return pytestTimeout;
  if (k.form === 'this.timeout') return 2000;
  if (file.playwright || k.form === 'test.setTimeout' || k.form.startsWith('describe.configure')) return 30000;
  if (file.nodeTest) return null;
  return 5000;
}

function testKnobFindings(ctx: CheckContext): Finding[] {
  const out: Finding[] = [];
  const baseOf = new Map<string, string>();
  for (const [b, h] of ctx.renames) baseOf.set(h, b);
  const pairedBase = new Map<string, string>();
  for (const p of ctx.matching.pairs) pairedBase.set(`${p.head.file}\0${p.head.test.name}`, p.base.test.name);
  for (const [path, file] of [...ctx.head.files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const base = ctx.base.files.get(baseOf.get(path) ?? path);
    const pytestTimeout = file.language === 'python' ? numberOf(pytestConfigFor(path, (p) => ctx.repo.read('head', p))?.options.get('timeout')?.value) : null;
    for (const k of file.knobs) {
      let counterpart: Knob | undefined;
      if (k.test !== null) {
        const baseTest = pairedBase.get(`${path}\0${k.test}`);
        counterpart = baseTest === undefined ? undefined : base?.knobs.filter((x) => x.test === baseTest && x.kind === k.kind && x.form === k.form).sort((x, y) => (y.value ?? 0) - (x.value ?? 0))[0];
      } else {
        counterpart = base?.knobs.find((x) => x.test === null && x.key === k.key);
      }
      if (k.value === null && k.form !== 'test.slow') {
        // A value we cannot read (`it('x', opts, fn)`, `jest.setTimeout(TIMEOUT)`): new or changed → review it.
        if (counterpart && counterpart.text === k.text) continue;
        const message =
          k.kind === 'options'
            ? `Test ${quote(k.test ?? '')} takes its options from \`${k.text}\`, which may set a timeout or retries: they cannot be read`
            : `${k.test !== null ? `Test ${quote(k.test)}: ` : ''}\`${k.text}\` sets a ${k.kind} that cannot be read`;
        out.push({ rule: 'TG005', severity: 'warn', file: path, side: 'head', line: k.line, test: k.test, message });
        continue;
      }
      if (k.form === 'test.slow') {
        if (!counterpart) {
          const who = k.test !== null ? `Test ${quote(k.test)}: ` : '';
          out.push({ rule: 'TG005', severity: 'warn', file: path, side: 'head', line: k.line, test: k.test, message: `${who}\`${k.text}\` triples the timeout` });
        }
        continue;
      }
      const before = counterpart ? counterpart.value : knobDefault(k, file, pytestTimeout);
      const msg = k.kind === 'options' ? null : knobFinding(k.kind, before, k.value, !counterpart, file.language === 'python' ? 's' : 'ms');
      if (!msg) continue;
      // `arg`/`options` knobs are part of the test declaration: name the test, not the whole call.
      const written = k.form === 'arg' || k.form.startsWith('options.') ? null : `\`${k.text}\``;
      const who = k.test !== null ? `Test ${quote(k.test)}${written ? ` (${written})` : ''}` : written!;
      out.push({ rule: 'TG005', severity: 'warn', file: path, side: 'head', line: k.line, test: k.test, message: `${who}: ${msg}` });
    }
  }
  return out;
}

export const TG005: Rule = {
  id: 'TG005',
  title: 'Timeouts, retries and test scope',
  async run(ctx) {
    const findings: Finding[] = [];
    for (const change of ctx.configChanges) {
      const path = change.headPath ?? change.basePath!;
      const bf = await factsOf(change.basePath ?? path, change.basePath ? ctx.repo.read('base', change.basePath) : null);
      const hf = await factsOf(path, change.headPath ? ctx.repo.read('head', change.headPath) : null);
      findings.push(...(await scopeFindings(ctx, change, bf, hf)));
      findings.push(...configKnobFindings(path, bf, hf));
    }
    findings.push(...testKnobFindings(ctx));
    return findings;
  },
};

