// TG005 pieces the fixtures do not pin down: config readers, the -k
// evaluator, script parsing, and the cases that must stay WARN because they
// cannot be evaluated with certainty.
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/check.js';
import type { FileChange } from '../src/git/diff.js';
import { parseIni } from '../src/config/ini.js';
import { readJsConfig } from '../src/config/js.js';
import { optionBool, optionList, parsePytestArgs, pytestConfigFor, readConftest, readPytestConfig } from '../src/config/pytest.js';
import { analyseTestScript, parseJestArgs, parseVitestArgs } from '../src/config/scripts.js';
import { tomlTable } from '../src/config/toml.js';
import { canonical, shellWords } from '../src/config/values.js';
import { evalK, parseK } from '../src/rules/scope.js';

async function tg005(files: Record<string, [string | null, string | null]>): Promise<string[]> {
  const changes: FileChange[] = Object.entries(files)
    .filter(([, [b, h]]) => b !== h)
    .map(([path, [b, h]]) => ({ status: b === null ? 'A' : h === null ? 'D' : 'M', basePath: b === null ? null : path, headPath: h === null ? null : path }));
  const report = await analyze({
    base: '0'.repeat(40),
    head: '1'.repeat(40),
    changes,
    read: (side, path) => files[path]?.[side === 'base' ? 0 : 1] ?? null,
    list: (side) => Object.keys(files).filter((p) => files[p]![side === 'base' ? 0 : 1] !== null),
  });
  return report.findings.filter((f) => f.rule === 'TG005').map((f) => `${f.severity} ${f.file}:${f.line}: ${f.message}`);
}

const TEST = `it('adds', () => { expect(1 + 1).toBe(2); });\n`;
const PY_TEST = `def test_roundtrip():\n    assert 1\n\n\ndef test_read():\n    assert 1\n`;

describe('config readers', () => {
  it('reads JS configs through defineConfig, module.exports and a const', async () => {
    const a = await readJsConfig('vitest.config.ts', `import { defineConfig, configDefaults } from 'vitest/config';\nconst t = 60 * 1000;\nexport default defineConfig(() => ({ test: { exclude: [...configDefaults.exclude, 'x/**'], testTimeout: t } }));\n`);
    expect(canonical(a)).toBe('{"test":{"exclude":[str:"**/node_modules/**",str:"**/.git/**",str:"x/**"],"testTimeout":num:60000}}');
    const b = await readJsConfig('jest.config.js', `const config = { testPathIgnorePatterns: ['/node_modules/', '<rootDir>/slow/'] };\nmodule.exports = config;\n`);
    expect(canonical(b)).toBe('{"testPathIgnorePatterns":[str:"/node_modules/",str:"<rootDir>/slow/"]}');
    const c = await readJsConfig('vitest.config.ts', `export default mergeConfig(a, b);\n`);
    expect(c.t).toBe('unknown');
  });

  it('decodes JS string escapes with certainty, or gives up', async () => {
    const B = String.fromCharCode(92);
    const decoded = await readJsConfig('vitest.config.ts', `export default { test: { include: ['**/*.${B}x74est.ts', '**/*.${B}u{73}pec.ts'] } };\n`);
    expect(canonical(decoded)).toBe('{"test":{"include":[str:"**/*.test.ts",str:"**/*.spec.ts"]}}');
    const octal = await readJsConfig('vitest.config.ts', `export default { test: { include: ['${B}101/**'] } };\n`);
    expect(canonical(octal)).toMatch(/^\{"test":\{"include":\[unknown:/);
  });

  it('does not read quoted INI list values', () => {
    const config = readPytestConfig('pytest.ini', '[pytest]\ntestpaths = "tests"\npython_files = test_*.py\n')!;
    expect(optionList(config.options.get('testpaths'))).toBeNull();
    expect(optionList(config.options.get('python_files'))).toEqual(['test_*.py']);
  });

  it('reads INI and the pytest table of pyproject.toml', () => {
    const ini = parseIni('[pytest]\naddopts =\n    -q\n    -k "not slow"\n# comment\nxfail_strict = true\n');
    expect(ini.get('pytest')?.get('addopts')).toEqual({ value: '\n-q\n-k "not slow"', line: 2 });
    const t = tomlTable('[tool.pytest.ini_options]\naddopts = ["-q", "--deselect", "a.py::b"]\nxfail_strict = true\n[tool.other]\nx = 1\n', 'tool.pytest.ini_options');
    expect([...t!.entries].map(([k, v]) => [k, canonical(v), v.line])).toEqual([
      ['addopts', '[str:"-q",str:"--deselect",str:"a.py::b"]', 2],
      ['xfail_strict', 'bool:true', 3],
    ]);
    expect(readPytestConfig('setup.cfg', '[metadata]\nname = x\n')).toBeNull();
    expect(readPytestConfig('pytest.ini', '')?.options.size).toBe(0);
  });

  it("finds the pytest config that applies to a file, with pytest's precedence (xfail_strict)", () => {
    const files: Record<string, string> = {
      'pytest.ini': '[pytest]\n',
      'pyproject.toml': '[tool.pytest.ini_options]\nxfail_strict = true\n',
      'pkg/setup.cfg': '[tool:pytest]\nxfail_strict = yes\n',
      'pkg/tox.ini': '[tox]\nenvlist = py\n',
    };
    const strict = (path: string): boolean | null | undefined => optionBool(pytestConfigFor(path, (p) => files[p] ?? null)?.options.get('xfail_strict'));
    // pytest.ini wins over pyproject.toml in the same directory, even without the option.
    expect(pytestConfigFor('tests/test_a.py', (p) => files[p] ?? null)?.path).toBe('pytest.ini');
    expect(strict('tests/test_a.py')).toBeUndefined();
    // The nearest directory with a pytest config wins; tox.ini without [pytest] does not count.
    expect(strict('pkg/tests/test_b.py')).toBe(true);
  });

  it('reads collect_ignore, and gives up when it is computed', async () => {
    expect((await readConftest('conftest.py', `collect_ignore = ["a.py"]\ncollect_ignore.append("b")\ncollect_ignore_glob = ["*_old.py"]\n`))).toMatchObject({ collectIgnore: ['a.py', 'b'], collectIgnoreGlob: ['*_old.py'] });
    expect((await readConftest('conftest.py', `import sys\nif sys.version_info < (3, 10):\n    collect_ignore = ["new.py"]\n`)).collectIgnore).toBeNull();
  });

  it('splits addopts like shlex and classifies pytest options', () => {
    expect(shellWords(`-q -k "not slow and not db" --deselect=a.py::t`)).toEqual(['-q', '-k', 'not slow and not db', '--deselect=a.py::t']);
    expect(parsePytestArgs(['-q', '-knot slow', '--ignore', 'legacy', '--reruns=2', 'tests/unit'])).toMatchObject({ k: 'not slow', ignore: ['legacy'], reruns: 2, paths: ['tests/unit'], unclassified: [] });
    expect(parsePytestArgs(['--strict-markers', 'tests']).unclassified).toEqual(['--strict-markers', 'tests']);
  });

  it('finds the runner invocation in the test script', () => {
    expect(analyseTestScript('cross-env CI=1 npx vitest run tests/unit && eslint .').runs).toEqual([{ runner: 'vitest', args: ['run', 'tests/unit'] }]);
    expect(analyseTestScript('npm run build && npm run unit').opaque).toEqual(['npm run build', 'npm run unit']);
    expect(parseVitestArgs(['run', 'tests/unit', '--exclude', 'x/**', '--retry=2', '--passWithNoTests'])).toMatchObject({ filters: ['tests/unit'], exclude: ['x/**'], retry: 2, passWithNoTests: true, opaque: [] });
    expect(parseVitestArgs(['--coverage.foo', 'bar']).opaque).toEqual(['--coverage.foo bar']);
    expect(parseJestArgs(['--testPathIgnorePatterns', '/a/', '/b/', '--ci']).ignore).toEqual(['/a/', '/b/']);
  });
});

describe('-k evaluation', () => {
  const names = ['tests', 'test_io.py', 'TestCodec', 'test_roundtrip'];
  it.each([
    ['not roundtrip', false, false],
    ['roundtrip', false, true],
    ['codec and not slow', false, true],
    ['slow', false, false],
    ['slow', true, null],
    ['not slow', true, null],
    ['ROUNDTRIP or slow', true, true],
    ['(io and codec) and not (db or net)', false, true],
  ] as const)('%s (hidden names: %s) → %s', (expr, hidden, expected) => {
    expect(evalK(parseK(expr)!, [...names], hidden)).toBe(expected);
  });

  it('rejects what pytest would reject', () => {
    expect(parseK('not')).toBeNull();
    expect(parseK('a b')).toBeNull();
    expect(parseK('(a')).toBeNull();
  });
});

describe('TG005 stays WARN when it cannot be certain', () => {
  it('a -k that could match names pytest adds at run time (conftest present) warns', async () => {
    const findings = await tg005({
      'pytest.ini': ['[pytest]\naddopts = -q\n', '[pytest]\naddopts = -q -k roundtrip\n'],
      'conftest.py': ['import sys\n', 'import sys\n'],
      'tests/test_io.py': [PY_TEST, PY_TEST],
    });
    expect(findings).toEqual([
      'warn pytest.ini:2: Test scope narrowed by `-k "roundtrip"`: its effect cannot be evaluated with certainty (some tests match the -k expression only through names we cannot see (parametrize ids, conftest marks))',
    ]);
  });

  it('the same -k without a conftest is evaluated: test_read is likely excluded (V0: WARN, never FAIL)', async () => {
    const findings = await tg005({
      'pytest.ini': ['[pytest]\naddopts = -q\n', '[pytest]\naddopts = -q -k roundtrip\n'],
      'tests/test_io.py': [PY_TEST, PY_TEST],
    });
    expect(findings).toEqual(['warn pytest.ini:2: Test scope reduced by `-k "roundtrip"`: likely excludes 1 test that ran at base: "tests/test_io.py::test_read"']);
  });

  it('jest positional patterns are regexes over absolute paths: warn, not fail', async () => {
    const pkg = (script: string): string => JSON.stringify({ scripts: { test: script }, jest: {} }, null, 2);
    const findings = await tg005({ 'package.json': [pkg('jest'), pkg('jest unit')], 'tests/a.test.js': [TEST, TEST], 'unit/b.test.js': [TEST, TEST] });
    expect(findings).toEqual(['warn package.json:3: Test scope narrowed by `unit`: its effect cannot be evaluated with certainty (the test script passes `unit` to jest (matched against absolute paths))']);
  });

  it('Playwright selection changes are reported, not evaluated', async () => {
    const cfg = (extra: string): string => `import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: 'e2e'${extra} });\n`;
    const findings = await tg005({ 'playwright.config.ts': [cfg(''), cfg(", testIgnore: ['**/slow/**']")], 'e2e/a.spec.ts': [TEST, TEST] });
    expect(findings).toEqual(['warn playwright.config.ts:2: Test scope narrowed by `testIgnore`: its effect cannot be evaluated with certainty (Playwright test selection is not evaluated)']);
  });

  it('a runner that is not known to run the project at base cannot fail', async () => {
    const findings = await tg005({ 'vitest.config.ts': [null, `export default { test: { exclude: ['tests/**'] } };\n`], 'tests/a.test.ts': [TEST, TEST] });
    expect(findings).toEqual(['warn vitest.config.ts:1: Test scope narrowed by `exclude` entry `tests/**`: its effect cannot be evaluated with certainty (vitest is not known to run this project at base)']);
  });

  it('without a file listing (in-memory analysis) nothing is certain', async () => {
    const report = await analyze({
      base: '0'.repeat(40),
      head: '1'.repeat(40),
      changes: [{ status: 'M', basePath: 'pytest.ini', headPath: 'pytest.ini' }],
      read: (side, path) => (path === 'pytest.ini' ? (side === 'base' ? '[pytest]\n' : '[pytest]\naddopts = --ignore=tests\n') : null),
    });
    expect(report.findings.map((f) => [f.severity, f.message])).toEqual([
      ['warn', 'Test scope narrowed by `--ignore=tests`: its effect cannot be evaluated with certainty (the repository file listing is not available)'],
    ]);
  });

  it('a vitest --exclude on the command line is evaluated like the config', async () => {
    const pkg = (script: string): string => JSON.stringify({ devDependencies: { vitest: '4' }, scripts: { test: script } }, null, 2);
    const findings = await tg005({ 'package.json': [pkg('vitest run'), pkg("vitest run --exclude 'tests/slow/**'")], 'tests/a.test.ts': [TEST, TEST], 'tests/slow/b.test.ts': [TEST, TEST] });
    expect(findings).toEqual(['warn package.json:6: Test scope reduced by `--exclude tests/slow/**`: likely excludes 1 test file that ran at base: "tests/slow/b.test.ts"']);
  });
});
