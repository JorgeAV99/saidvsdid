// Which test files (and, for pytest's -k / --deselect, which tests) a runner
// selects, computed from its configuration the way the runner itself does.
//
// Every evaluator either returns a certain answer or says why it cannot:
// patterns we do not reproduce exactly, values that are not literals,
// options that change the selection in ways we do not model. TG005 only
// fails on a certain answer.
import { readConftest, optionArgs, optionList, parsePytestArgs, readPytestConfig, PYTEST_CONFIG_FILES, type PytestArgs, type PytestConfig } from '../config/pytest.js';
import { readJsConfig } from '../config/js.js';
import { parseJsonValue } from '../config/json.js';
import { analyseTestScript, parseJestArgs, parseVitestArgs, type JestArgs, type VitestArgs } from '../config/scripts.js';
import { prop, stringList, type ConfigValue } from '../config/values.js';
import type { TestCase } from '../parse/index.js';
import { fnmatchRegExp, picomatchRegExp } from '../util/runner-glob.js';

export type Runner = 'vitest' | 'jest' | 'pytest' | 'playwright';

/** One side of the repository as the scope evaluators see it. */
export interface View {
  files: readonly string[];
  read(path: string): string | null;
}

export type Selection =
  | { certain: true; files: Set<string>; tests?: (file: string, test: TestCase) => boolean | null }
  | { certain: false; reason: string };

const uncertain = (reason: string): Selection => ({ certain: false, reason });

export const VITEST_CONFIGS = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.cts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs'];
export const JEST_CONFIGS = ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.mts', 'jest.config.cts', 'jest.config.json'];
export const PLAYWRIGHT_CONFIGS = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mts', 'playwright.config.mjs', 'playwright.config.cts', 'playwright.config.cjs'];

const VITEST_INCLUDE = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];
const VITEST_EXCLUDE = ['**/node_modules/**', '**/.git/**'];
const JEST_TEST_MATCH = ['**/__tests__/**/*.?([mc])[jt]s?(x)', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)'];
const JEST_IGNORE = ['/node_modules/'];
const PY_FILES = ['test_*.py', '*_test.py'];
const PY_NORECURSE = ['*.egg', '.*', '_darcs', 'build', 'CVS', 'dist', 'node_modules', 'venv', '{arch}'];

export const join = (dir: string, rel: string): string => (dir ? `${dir}/${rel}` : rel);

/** Path relative to `dir`, or null if it is not below it. */
export function below(dir: string, path: string): string | null {
  if (!dir) return path;
  return path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : null;
}

function normalisePath(p: string): string {
  let q = p.replace(/\\/g, '/');
  while (q.startsWith('./')) q = q.slice(2);
  return q.replace(/\/+$/, '') || '.';
}

// ---------------------------------------------------------------------------
// package.json / JS configs

export async function jsConfig(view: View, dir: string, names: string[]): Promise<{ path: string; value: ConfigValue } | null> {
  for (const name of names) {
    const path = join(dir, name);
    const text = view.read(path);
    if (text === null) continue;
    return { path, value: name.endsWith('.json') ? (parseJsonValue(text) ?? { t: 'unknown', text: 'invalid JSON', line: 1 }) : await readJsConfig(path, text) };
  }
  return null;
}

export function packageJson(view: View, dir: string): ConfigValue | null {
  const text = view.read(join(dir, 'package.json'));
  return text === null ? null : (parseJsonValue(text) ?? { t: 'unknown', text: 'invalid JSON', line: 1 });
}

/** The `test` script's invocation of `runner`: its arguments, null if not invoked, 'opaque' if we cannot tell. */
export function scriptInvocation(pkg: ConfigValue | null, runner: Runner): string[] | null | 'opaque' {
  const script = prop(prop(pkg, 'scripts'), 'test');
  if (!script) return null;
  if (script.t !== 'str') return 'opaque';
  const runs = analyseTestScript(script.v).runs.filter((r) => r.runner === runner);
  if (runs.length > 1) return 'opaque';
  return runs[0]?.args ?? null;
}

// ---------------------------------------------------------------------------
// Vitest

export async function vitestSelection(view: View, dir: string): Promise<Selection> {
  const config = await jsConfig(view, dir, VITEST_CONFIGS);
  let include = VITEST_INCLUDE;
  let exclude = VITEST_EXCLUDE;
  if (config) {
    if (config.value.t !== 'obj') return uncertain(`${config.path}: the exported configuration is not a literal object`);
    for (const key of ['root', 'projects', 'workspace']) if (prop(config.value, key)) return uncertain(`${config.path}: \`${key}\` is set`);
    const test = prop(config.value, 'test');
    if (test && test.t !== 'obj') return uncertain(`${config.path}: \`test\` is not a literal object`);
    if (test?.t === 'obj' && test.open) return uncertain(`${config.path}: \`test\` has spread or computed properties`);
    for (const key of ['root', 'dir', 'projects', 'workspace']) if (prop(test, key)) return uncertain(`${config.path}: \`test.${key}\` is set`);
    const inc = prop(test, 'include');
    const exc = prop(test, 'exclude');
    if (inc) {
      const l = stringList(inc);
      if (!l) return uncertain(`${config.path}: \`include\` is not a list of literal strings`);
      include = l;
    }
    if (exc) {
      const l = stringList(exc);
      if (!l) return uncertain(`${config.path}: \`exclude\` is not a list of literal strings`);
      exclude = l;
    }
  }
  const args = scriptInvocation(packageJson(view, dir), 'vitest');
  if (args === 'opaque') return uncertain(`${join(dir, 'package.json')}: the test script runs vitest in a way we cannot read`);
  const cli: VitestArgs = parseVitestArgs(args ?? []);
  if (cli.opaque.length > 0) return uncertain(`the test script passes ${cli.opaque.map((o) => `\`${o}\``).join(', ')} to vitest`);
  // The same option on the command line and in the config: which one wins is not modelled.
  if (cli.exclude.length > 0 && config && prop(prop(config.value, 'test'), 'exclude')) {
    return uncertain('the test script passes `--exclude` to vitest, and the configuration sets `exclude` too');
  }
  const inc = include.map(picomatchRegExp);
  const exc = [...exclude, ...cli.exclude].map(picomatchRegExp);
  if (inc.some((r) => r === null) || exc.some((r) => r === null)) return uncertain('a vitest glob uses syntax we do not reproduce exactly');
  const filters = cli.filters.map((f) => f.toLowerCase());
  const files = new Set<string>();
  for (const f of view.files) {
    const rel = below(dir, f);
    if (rel === null) continue;
    if (!inc.some((r) => r!.test(rel)) || exc.some((r) => r!.test(rel))) continue;
    if (filters.length > 0 && !filters.some((x) => rel.toLowerCase().includes(x))) continue;
    files.add(f);
  }
  return { certain: true, files };
}

// ---------------------------------------------------------------------------
// Jest

/** jest.config.* or package.json's `jest` field. */
export async function jestConfig(view: View, dir: string): Promise<{ path: string; value: ConfigValue } | null> {
  const own = await jsConfig(view, dir, JEST_CONFIGS);
  if (own) return own;
  const jest = prop(packageJson(view, dir), 'jest');
  return jest ? { path: join(dir, 'package.json'), value: jest } : null;
}

const ROOT_SENTINEL = '/\u0000rootDir';

export async function jestSelection(view: View, dir: string): Promise<Selection> {
  const config = await jestConfig(view, dir);
  let testMatch = JEST_TEST_MATCH;
  let ignore = JEST_IGNORE;
  let roots: string[] = [''];
  if (config) {
    const c = config.value;
    if (c.t !== 'obj' || c.open) return uncertain(`${config.path}: the jest configuration is not a literal object`);
    for (const key of ['projects', 'preset', 'testRegex', 'rootDir']) {
      const v = prop(c, key);
      if (v && !(v.t === 'arr' && v.items.length === 0) && !(key === 'rootDir' && v.t === 'str' && ['.', '<rootDir>'].includes(v.v))) {
        return uncertain(`${config.path}: \`${key}\` is set`);
      }
    }
    const tm = prop(c, 'testMatch');
    if (tm) {
      const l = stringList(tm);
      if (!l) return uncertain(`${config.path}: \`testMatch\` is not a list of literal strings`);
      testMatch = l;
    }
    const ig = prop(c, 'testPathIgnorePatterns');
    if (ig) {
      const l = stringList(ig);
      if (!l) return uncertain(`${config.path}: \`testPathIgnorePatterns\` is not a list of literal strings`);
      ignore = l;
    }
    const r = prop(c, 'roots');
    if (r) {
      const l = stringList(r);
      if (!l || l.some((x) => x !== '<rootDir>' && !x.startsWith('<rootDir>/'))) return uncertain(`${config.path}: \`roots\` is not a list of <rootDir> paths`);
      roots = l.map((x) => normalisePath(x.slice('<rootDir>'.length).replace(/^\//, '')).replace(/^\.$/, ''));
    }
  }
  const args = scriptInvocation(packageJson(view, dir), 'jest');
  if (args === 'opaque') return uncertain(`${join(dir, 'package.json')}: the test script runs jest in a way we cannot read`);
  const cli: JestArgs = parseJestArgs(args ?? []);
  if (cli.opaque.length > 0) return uncertain(`the test script passes ${cli.opaque.map((o) => `\`${o}\``).join(', ')} to jest (matched against absolute paths)`);
  // On the command line, --testPathIgnorePatterns replaces the configured list.
  if (cli.ignore.length > 0 && config && prop(config.value, 'testPathIgnorePatterns')) {
    return uncertain('the test script passes `--testPathIgnorePatterns` to jest, which overrides the configured `testPathIgnorePatterns`');
  }
  // testMatch globs are matched against absolute paths: only `**/`-prefixed or <rootDir>-anchored ones are portable.
  const match: RegExp[] = [];
  for (const m of testMatch) {
    const rel = m.startsWith('<rootDir>/') ? m.slice('<rootDir>/'.length) : m.startsWith('**/') ? m : null;
    const re = rel === null ? null : picomatchRegExp(rel);
    if (!re) return uncertain(`testMatch pattern \`${m}\` cannot be evaluated on relative paths`);
    match.push(re);
  }
  const ignores: RegExp[] = [];
  for (const p of [...ignore, ...cli.ignore]) {
    if (p.startsWith('^')) return uncertain(`testPathIgnorePatterns \`${p}\` is anchored to the absolute path`);
    try {
      ignores.push(new RegExp(p.split('<rootDir>').join(ROOT_SENTINEL)));
    } catch {
      return uncertain(`testPathIgnorePatterns \`${p}\` is not a valid regular expression`);
    }
  }
  const files = new Set<string>();
  for (const f of view.files) {
    const rel = below(dir, f);
    if (rel === null) continue;
    if (!roots.some((r) => r === '' || rel.startsWith(`${r}/`))) continue;
    if (!match.some((m) => m.test(rel))) continue;
    if (ignores.some((i) => i.test(`${ROOT_SENTINEL}/${rel}`))) continue;
    files.add(f);
  }
  return { certain: true, files };
}

// ---------------------------------------------------------------------------
// pytest

export function pytestConfigAt(view: View, dir: string): PytestConfig | null {
  for (const name of PYTEST_CONFIG_FILES) {
    const text = view.read(join(dir, name));
    if (text === null) continue;
    const config = readPytestConfig(join(dir, name), text);
    if (config) return config;
  }
  return null;
}

/** pytest's `-k` expression language, three-valued: null = cannot tell. */
type KExpr = { op: 'and' | 'or'; l: KExpr; r: KExpr } | { op: 'not'; e: KExpr } | { op: 'id'; v: string };

export function parseK(text: string): KExpr | null {
  const tokens = text.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const expr = (): KExpr | null => {
    let l = andExpr();
    while (l && tokens[i] === 'or') {
      i++;
      const r = andExpr();
      if (!r) return null;
      l = { op: 'or', l, r };
    }
    return l;
  };
  const andExpr = (): KExpr | null => {
    let l = notExpr();
    while (l && tokens[i] === 'and') {
      i++;
      const r = notExpr();
      if (!r) return null;
      l = { op: 'and', l, r };
    }
    return l;
  };
  const notExpr = (): KExpr | null => {
    const t = tokens[i];
    if (t === 'not') {
      i++;
      const e = notExpr();
      return e ? { op: 'not', e } : null;
    }
    if (t === '(') {
      i++;
      const e = expr();
      if (tokens[i++] !== ')') return null;
      return e;
    }
    if (t && /^[\w:+\-.[\]\\/]+$/.test(t) && !['and', 'or', 'not'].includes(t)) {
      i++;
      return { op: 'id', v: t };
    }
    return null;
  };
  if (tokens.length === 0) return null;
  const e = expr();
  return e && i === tokens.length ? e : null;
}

/**
 * Evaluates `-k` for one test. `names` are what pytest matches against
 * (directories below the rootdir, module file, classes, function, marks);
 * `hidden` means the test may carry names we cannot see (parametrize ids,
 * marks added by a conftest), so an identifier that matches nothing is unknown.
 */
export function evalK(e: KExpr, names: string[], hidden: boolean): boolean | null {
  switch (e.op) {
    case 'id': {
      const v = e.v.toLowerCase();
      if (names.some((n) => n.toLowerCase().includes(v))) return true;
      return hidden ? null : false;
    }
    case 'not': {
      const x = evalK(e.e, names, hidden);
      return x === null ? null : !x;
    }
    case 'and': {
      const l = evalK(e.l, names, hidden);
      const r = evalK(e.r, names, hidden);
      if (l === false || r === false) return false;
      return l === null || r === null ? null : true;
    }
    case 'or': {
      const l = evalK(e.l, names, hidden);
      const r = evalK(e.r, names, hidden);
      if (l === true || r === true) return true;
      return l === null || r === null ? null : false;
    }
  }
}

function underPath(rel: string, p: string): boolean {
  return p === '.' || rel === p || rel.startsWith(`${p}/`);
}

export interface PytestProject {
  config: PytestConfig | null;
  args: PytestArgs;
}

export async function pytestSelection(view: View, rootdir: string): Promise<Selection> {
  const config = pytestConfigAt(view, rootdir);
  const words = optionArgs(config?.options.get('addopts'));
  if (words === null) return uncertain(`${config?.path}: \`addopts\` cannot be read`);
  const args = parsePytestArgs(words);
  if (args.unclassified.length > 0) return uncertain(`addopts contains ${args.unclassified.map((u) => `\`${u}\``).join(' ')}, which we cannot classify`);
  if (args.m !== null) return uncertain('`-m` marker expressions are not evaluated');
  // A pytest run from the package.json test script: its arguments come after
  // addopts (a later -k wins, paths replace testpaths). Not modelled.
  const script = scriptInvocation(packageJson(view, rootdir), 'pytest');
  if (script === 'opaque') return uncertain('the test script runs pytest in a way we cannot read');
  if (script) {
    const s = parsePytestArgs(script);
    const selecting = [...(s.k !== null ? ['-k'] : []), ...(s.m !== null ? ['-m'] : []), ...s.deselect.map(() => '--deselect'), ...s.ignore.map(() => '--ignore'), ...s.ignoreGlob.map(() => '--ignore-glob'), ...s.paths, ...s.unclassified];
    if (selecting.length > 0) return uncertain(`the test script passes ${[...new Set(selecting)].map((o) => `\`${o}\``).join(', ')} to pytest, on top of addopts`);
  }
  for (const key of ['testpaths', 'python_files', 'norecursedirs']) {
    if (config?.options.has(key) && optionList(config.options.get(key)) === null) return uncertain(`\`${key}\` cannot be read with certainty`);
  }
  const testpaths = optionList(config?.options.get('testpaths'));
  if (testpaths?.some((t) => /[*?[]/.test(t))) return uncertain('`testpaths` uses glob patterns');
  const pyFiles = optionList(config?.options.get('python_files')) ?? PY_FILES;
  const norecurse = (optionList(config?.options.get('norecursedirs')) ?? PY_NORECURSE).map(fnmatchRegExp);
  const pyFileRes = pyFiles.map(fnmatchRegExp);
  const roots = (args.paths.length > 0 ? args.paths : testpaths && testpaths.length > 0 ? testpaths : ['.']).map(normalisePath);
  const ignores = args.ignore.map(normalisePath);
  const ignoreGlobs = args.ignoreGlob.map((g) => fnmatchRegExp(normalisePath(g)));
  const deselect = args.deselect;

  const conftests: Array<{ dir: string; ignore: string[]; globs: RegExp[] }> = [];
  for (const f of view.files) {
    const rel = below(rootdir, f);
    if (rel === null || !(rel === 'conftest.py' || rel.endsWith('/conftest.py'))) continue;
    const c = await readConftest(f, view.read(f) ?? '');
    if (c.collectIgnore === null || c.collectIgnoreGlob === null) return uncertain(`${f}: collect_ignore is computed in a way we cannot read`);
    const cdir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    conftests.push({ dir: cdir, ignore: c.collectIgnore.map((p) => normalisePath(join(cdir, p))), globs: c.collectIgnoreGlob.map((g) => fnmatchRegExp(join(cdir, g))) });
  }
  const anyConftest = conftests.length > 0;

  const files = new Set<string>();
  for (const f of view.files) {
    const rel = below(rootdir, f);
    if (rel === null || !rel.endsWith('.py')) continue;
    const root = roots.find((r) => underPath(rel, r));
    if (root === undefined) continue;
    if (rel !== root) {
      const base = rel.slice(rel.lastIndexOf('/') + 1);
      if (!pyFileRes.some((r) => r.test(base))) continue;
      const inner = root === '.' ? rel : rel.slice(root.length + 1);
      const dirs = inner.split('/').slice(0, -1);
      if (dirs.some((d) => norecurse.some((r) => r.test(d)))) continue;
    }
    if (ignores.some((i) => underPath(rel, i)) || ignoreGlobs.some((g) => g.test(rel))) continue;
    if (conftests.some((c) => (c.dir === '' || rel.startsWith(`${c.dir}/`)) && (c.ignore.some((i) => underPath(rel, i)) || c.globs.some((g) => g.test(rel))))) continue;
    files.add(f);
  }

  const k = args.k === null ? null : parseK(args.k);
  if (args.k !== null && k === null) return uncertain(`-k expression \`${args.k}\` cannot be parsed`);
  const tests =
    k === null && deselect.length === 0
      ? undefined
      : (file: string, test: TestCase): boolean | null => {
          const rel = below(rootdir, file) ?? file;
          if (deselect.some((d) => `${rel}::${test.name}`.startsWith(d))) return false;
          if (!k) return true;
          const parts = rel.split('/');
          const names = [...parts, ...test.name.split('::'), ...test.marks];
          return evalK(k, names, anyConftest || test.marks.includes('parametrize'));
        };
  return { certain: true, files, ...(tests ? { tests } : {}) };
}
