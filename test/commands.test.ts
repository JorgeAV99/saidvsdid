// Shell commands as agents run them: launchers, operators, test detection,
// exit status of a segment, runner summaries.
import { describe, expect, it } from 'vitest';
import { classifySegment, packageScripts, parseSummary, segmentExit, segmentStatus } from '../src/transcript/commands.js';
import { redirects, segments, unwrap } from '../src/transcript/shell.js';

describe('unwrap', () => {
  it.each([
    [String.raw`"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'npm.cmd test'`, 'npm.cmd test', 'powershell'],
    [String.raw`"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Get-Location; rg --files -g '*test*'"`, "Get-Location; rg --files -g '*test*'", 'powershell'],
    ['pwsh -NoProfile -Command npm test', 'npm test', 'powershell'],
    ["bash -lc 'npm test && echo ok'", 'npm test && echo ok', 'posix'],
    [`/bin/zsh -c "python -m pytest -q"`, 'python -m pytest -q', 'posix'],
    ['cmd /d /s /c npm test', 'npm test', 'cmd'],
    ['npm test', 'npm test', 'posix'],
  ])('%s', (command, inner, dialect) => {
    expect(unwrap(command)).toEqual({ inner, dialect });
  });
});

describe('segments', () => {
  it('splits on operators outside quotes and keeps redirections', () => {
    expect(segments(`cd "<REPO>" && npm test 2>&1 | tail -20; echo "a && b"`, 'posix')).toEqual([
      { text: 'cd "<REPO>"', before: null, after: '&&' },
      { text: 'npm test 2>&1', before: '&&', after: '|' },
      { text: 'tail -20', before: '|', after: ';' },
      { text: 'echo "a && b"', before: ';', after: null },
    ]);
  });

  it('PowerShell: `&` is the call operator; cmd: `&` separates commands', () => {
    expect(segments(`& "C:/x/npm.cmd" test; git status`, 'powershell').map((s) => s.text)).toEqual(['& "C:/x/npm.cmd" test', 'git status']);
    expect(segments('npm test & echo done', 'cmd').map((s) => [s.text, s.before])).toEqual([['npm test', null], ['echo done', ';']]);
    expect(segments('npm test &', 'posix')).toEqual([{ text: 'npm test', before: null, after: '&' }]);
  });

  it('redirections: files, not duplications, quotes or sanitiser markers', () => {
    expect(redirects('npm test > out.txt 2>&1')).toEqual([{ fd: '1', target: 'out.txt' }]);
    expect(redirects('echo "a > b" 2>/dev/null')).toEqual([{ fd: '2', target: '/dev/null' }]);
    expect(redirects('cd "<REPO>"')).toEqual([]);
  });
});

describe('classifySegment', () => {
  const scripts = { test: 'vitest run', 'test:unit': 'npm run test', lint: 'eslint .', e2e: 'playwright test', build: 'tsc' };
  it.each([
    // recognised runs
    ['npm test', { kind: 'test', framework: 'vitest', selection: 'full', filter: null }],
    ['npm.cmd test', { kind: 'test', framework: 'vitest', selection: 'full', filter: null }],
    ['npm run test:unit', { kind: 'test', framework: 'vitest', selection: 'full', filter: null }],
    ['npm test -- test/stats.test.ts', { kind: 'test', framework: 'vitest', selection: 'filtered', filter: 'test/stats.test.ts' }],
    ['npm test -- -t median', { kind: 'test', framework: 'vitest', selection: 'filtered', filter: '-t median' }],
    ['npm test --workspace api', { kind: 'test', framework: 'vitest', selection: 'unknown', filter: '--workspace api' }],
    ['yarn e2e --grep login', { kind: 'test', framework: 'playwright', selection: 'filtered', filter: '--grep login' }],
    ['npx vitest run', { kind: 'test', framework: 'vitest', selection: 'full', filter: null }],
    ['npx vitest run --bail=1', { kind: 'test', framework: 'vitest', selection: 'filtered', filter: '--bail=1' }],
    ['node node_modules/vitest/vitest.mjs run', { kind: 'test', framework: 'vitest', selection: 'full', filter: null }],
    ['CI=1 npx jest --ci', { kind: 'test', framework: 'jest', selection: 'full', filter: null }],
    ['jest src/a.test.ts', { kind: 'test', framework: 'jest', selection: 'filtered', filter: 'src/a.test.ts' }],
    ['python -m pytest -q', { kind: 'test', framework: 'pytest', selection: 'full', filter: null }],
    ['python3 -m pytest -q -k word_count', { kind: 'test', framework: 'pytest', selection: 'filtered', filter: '-k word_count' }],
    ['py -m pytest tests/test_x.py::test_y', { kind: 'test', framework: 'pytest', selection: 'filtered', filter: 'tests/test_x.py::test_y' }],
    ['pytest -x', { kind: 'test', framework: 'pytest', selection: 'filtered', filter: '-x' }],
    ['pytest .', { kind: 'test', framework: 'pytest', selection: 'full', filter: null }],
    ['.venv/bin/python -m pytest -c other.ini', { kind: 'test', framework: 'pytest', selection: 'unknown', filter: '-c' }],
    // not runs
    ['pytest --collect-only', { kind: 'readonly' }],
    ['npx vitest list', { kind: 'readonly' }],
    ['cat test/stats.test.ts', { kind: 'readonly' }],
    ['Get-Content tests/test_toytext.py', { kind: 'readonly' }],
    ['git diff --check', { kind: 'readonly' }],
    ["sed -n '1,20p' src/x.ts", { kind: 'readonly' }],
    ['cd "<REPO>"', { kind: 'cd', dir: '<REPO>' }],
    // might be runs
    ['make test', { kind: 'possible_test' }],
    ['tox -e py312', { kind: 'possible_test' }],
    ['python -m unittest', { kind: 'possible_test' }],
    ['npm run test:e2e', { kind: 'possible_test' }],
    // may write files
    ["sed -i 's/a/b/' src/x.ts", { kind: 'mutating' }],
    ['echo x > src/x.ts', { kind: 'mutating' }],
    ['rm tests/test_x.py', { kind: 'mutating' }],
    ['git checkout -- src', { kind: 'mutating' }],
    ['npm run build', { kind: 'mutating' }],
    ['npm run lint', { kind: 'mutating' }],
    ['python fix.py', { kind: 'mutating' }],
    ['Set-Content src/stats.ts', { kind: 'mutating' }],
  ])('%s', (text, expected) => {
    const dialect = /^(Get-|Set-)/.test(text) ? 'powershell' : 'posix';
    expect(classifySegment(text, dialect, scripts)).toEqual(expected);
  });

  it('without package.json, `npm test` is still the project test command (framework unknown)', () => {
    expect(classifySegment('npm test', 'posix', null)).toEqual({ kind: 'test', framework: 'unknown', selection: 'full', filter: null });
    expect(classifySegment('npm run check', 'posix', null)).toEqual({ kind: 'mutating' });
  });

  it('reads package.json scripts, with or without a byte-order mark', () => {
    expect(packageScripts(`${String.fromCharCode(0xfeff)}{"scripts":{"test":"jest"}}`)).toEqual({ test: 'jest' });
    expect(packageScripts('{"name":"x"}')).toEqual({});
    expect(packageScripts('not json')).toBeNull();
    expect(packageScripts(null)).toBeNull();
  });
});

describe('segmentExit', () => {
  const exitOf = (command: string, whole: number | null, index = -1): number | null => {
    const segs = segments(command, 'posix');
    const i = index >= 0 ? index : segs.findIndex((s) => /npm test|pytest/.test(s.text));
    return segmentExit(segs, i, whole);
  };
  it.each([
    ['npm test', 0, 0],
    ['npm test', 1, 1],
    ['npm test', null, null],
    ['cd x && npm test', 0, 0],
    ['cd x && npm test', 1, null], // cd may have failed
    ['cd x; npm test', 1, 1],
    ['npm test 2>&1 | tail -20', 0, null], // tail's status
    ['set -o pipefail; npm test | tail -20', 0, 0],
    ['set -o pipefail; npm test | tail -20', 1, null],
    ['python -m pytest -q; git diff --check', 0, null], // git's status
    ['npm test && git diff', 0, 0],
    ['npm test && git diff', 1, null],
    ['npm test || true', 0, null],
    ['false || npm test', 0, null],
    ['npm test &', 0, null],
  ])('%s exiting %s → %s', (command, whole, expected) => {
    expect(exitOf(command, whole)).toBe(expected);
  });
});

describe('segmentStatus: why an exit status is unknown', () => {
  const status = (command: string, whole: number | null): ReturnType<typeof segmentStatus> => {
    const segs = segments(command, 'posix');
    return segmentStatus(segs, segs.findIndex((s) => /npm test|pytest/.test(s.text)), whole);
  };
  it.each([
    ['npm test', 0, { exit: 0, unknown: null }],
    ['cd x && npm test 2>&1 | tail -20', 0, { exit: null, unknown: 'pipe' }],
    ['python -m pytest -q; git diff --check', 0, { exit: null, unknown: 'chain' }],
    ['cd x && npm test', 1, { exit: null, unknown: 'chain' }],
    ['npm test &', 0, { exit: null, unknown: 'background' }],
    ['npm test', null, { exit: null, unknown: 'no_result' }],
    ['set -o pipefail; npm test | tail', 1, { exit: null, unknown: 'pipe' }],
  ])('%s exiting %s', (command, whole, expected) => {
    expect(status(command, whole)).toEqual(expected);
  });
});

describe('parseSummary', () => {
  it('vitest, including files that fail to load and unhandled errors', () => {
    expect(parseSummary('\n Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 6 passed (7)\n', 'vitest')).toEqual({ framework: 'vitest', summary: { passed: 6, failed: 1, skipped: 0 } });
    expect(parseSummary(' Test Files  1 failed (1)\n      Tests  no tests\n', 'vitest')).toEqual({ framework: 'vitest', summary: { passed: 0, failed: 1, skipped: 0 } });
    expect(parseSummary(' Test Files  1 passed (1)\n      Tests  3 passed | 1 skipped (4)\n     Errors  1 error\n', 'vitest')).toEqual({ framework: 'vitest', summary: { passed: 3, failed: 1, skipped: 1 } });
  });
  it('jest', () => {
    expect(parseSummary('Test Suites: 1 failed, 2 passed, 3 total\nTests:       1 failed, 9 passed, 10 total\n', 'jest')).toEqual({ framework: 'jest', summary: { passed: 9, failed: 1, skipped: 0 } });
  });
  it('pytest, quiet and verbose', () => {
    expect(parseSummary('........\r\n8 passed in 0.02s\r\n', 'pytest')).toEqual({ framework: 'pytest', summary: { passed: 8, failed: 0, skipped: 0 } });
    expect(parseSummary('===== 4 failed, 6 passed, 1 xfailed in 0.05s =====\n', 'pytest')).toEqual({ framework: 'pytest', summary: { passed: 6, failed: 4, skipped: 1 } });
    expect(parseSummary('==== 1 error in 0.10s ====\n', 'pytest')).toEqual({ framework: 'pytest', summary: { passed: 0, failed: 1, skipped: 0 } });
  });
  // Real outputs (vitest 4.1.11, pytest 8.4.2) as agents' transcripts hold them: vitest's `agent` reporter
  // (std-env detects CLAUDECODE, AI_AGENT…: no line for what passed, no colours), and both runners' colours.
  it('the agent reporter and coloured summaries, as real agents record them', () => {
    const agentPass = '\n RUN  v4.1.11 <REPO>\n\n\n Test Files  1 passed (1)\n      Tests  5 passed (5)\n   Start at  12:23:16\n   Duration  123ms (transform 17ms, setup 0ms, import 26ms, tests 2ms, environment 0ms)\n\n';
    const agentFail =
      '\n RUN  v4.1.11 <REPO>\n\n ❯ test/stats.test.ts (5 tests | 2 failed) 5ms\n     × returns the middle value of an odd-length list 3ms\n     × sorts numerically, not as strings 0ms\n\n' +
      '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  test/stats.test.ts > median > returns the middle value of an odd-length list\nAssertionError: expected 1 to be 2 // Object.is equality\n\n' +
      ' Test Files  1 failed (1)\n      Tests  2 failed | 3 passed (5)\n   Start at  12:23:17\n   Duration  140ms\n';
    const colouredFail = '\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[31m1 failed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[31m2 failed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (5)\u001b[39m\n';
    const pytestColoured = '\u001b[32m============================== \u001b[32m\u001b[1m6 passed\u001b[0m\u001b[32m in 0.01s\u001b[0m\u001b[32m ==============================\u001b[0m\n';
    for (const fw of ['vitest', 'unknown'] as const) {
      expect(parseSummary(agentPass, fw)).toEqual({ framework: 'vitest', summary: { passed: 5, failed: 0, skipped: 0 } });
      expect(parseSummary(agentFail, fw)).toEqual({ framework: 'vitest', summary: { passed: 3, failed: 2, skipped: 0 } });
      expect(parseSummary(colouredFail, fw)).toEqual({ framework: 'vitest', summary: { passed: 3, failed: 2, skipped: 0 } });
    }
    expect(parseSummary(pytestColoured, 'pytest')).toEqual({ framework: 'pytest', summary: { passed: 6, failed: 0, skipped: 0 } });
  });
  it('detects the runner from the output when the command does not say', () => {
    expect(parseSummary(' RUN  v4.1.11 x\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)\n', 'unknown')?.framework).toBe('vitest');
  });
  it('two summaries or none: null', () => {
    expect(parseSummary('6 passed in 0.1s\n...\n2 passed in 0.1s\n', 'pytest')).toBeNull();
    expect(parseSummary('no summary here', 'unknown')).toBeNull();
  });
});
