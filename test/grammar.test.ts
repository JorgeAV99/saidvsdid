// The closed grammar of a placed test run (src/transcript/grammar.ts): what is
// inside, and a sample of what is outside. The real-shell oracle
// (test/shell-cwd-real.test.ts) checks that what is inside is placed exactly.
import { describe, expect, it } from 'vitest';
import { callShape } from '../src/transcript/grammar.js';

const shape = (cmd: string, dialect: 'posix' | 'powershell' = 'posix') => callShape(cmd, dialect, () => 'vitest');

describe('the closed grammar of a placed run', () => {
  it('inside: [cd LIT &&] [VAR=v] runner allowed-args [2>&1] [| tail|head|grep|tee]', () => {
    for (const [cmd, cd, positionals] of [
      ['npm test', null, []],
      ['npm.cmd test', null, []],
      ['npm test 2>&1 | tail -20', null, []],
      ['cd <REPO> && npm test 2>&1 | tail -20', '<REPO>', []],
      ["cd '/home/u/repo' && CI=1 npx vitest run -t 'median' src/a.test.ts", '/home/u/repo', ['src/a.test.ts']],
      ['npm run test -- -t median', null, []],
      ['npx vitest run --reporter=dot | grep -E "passed|failed"', null, []],
      ['python -m pytest -xq tests/test_a.py::test_b', null, ['tests/test_a.py::test_b']],
      ['pytest -k "a or b" -m slow --tb=short', null, []],
      ['npx jest --ci -t x', null, []],
      ['npx playwright test --project chromium', null, []],
      ['npm test | tee out.log', null, []],
    ] as const) {
      expect([cmd, shape(cmd)]).toEqual([cmd, { kind: 'run', cd, positionals }]);
    }
    expect(shape("cd 'C:/work/repo'")).toEqual({ kind: 'cd', dir: 'C:/work/repo' });
  });

  it('quotes are read as the shell reads them: escapes are literal, expansions are not', () => {
    // inside: an escape inside double quotes, `$` inside single quotes, an escaped `$`
    for (const cmd of [
      'npx vitest run src/a.test.ts 2>&1 | grep -E "Tests \\|passed" | head -30',
      'npm test 2>&1 | grep -E "^\\s+(x|y)|say \\"hi\\"" | head -5',
      "npm test | grep -E 'passed$|failed'",
      'npm test | grep "\\$HOME"',
      'npm test | grep a\\|b',
    ]) {
      expect([cmd, shape(cmd).kind]).toEqual([cmd, 'run']);
    }
    // outside: an expansion inside double quotes, a line continuation
    for (const cmd of ['npm test | grep "$HOME"', 'npm test | grep "`pwd`"', 'npm test | grep "$(pwd)"', 'npm test \\\n | tail']) {
      expect([cmd, shape(cmd).kind]).toEqual([cmd, 'other']);
    }
    // PowerShell: a backquote escapes, `$` expands
    expect(callShape('npm.cmd test 2>&1 | grep "a`$b"', 'powershell').kind).toBe('run');
    expect(callShape('npm.cmd test 2>&1 | grep "$env:X"', 'powershell').kind).toBe('other');
  });

  it('PowerShell as PowerShell reads it; cmd.exe, which no oracle runs, is outside', () => {
    const ps = (cmd: string) => callShape(cmd, 'powershell').kind;
    expect(ps("cd 'C:\\work\\repo' && npm.cmd test")).toBe('run');
    expect(ps('npx vitest run -t "a``b"')).toBe('run');
    // `n, `r, `t… are special characters, not letters
    expect(ps('cd "s`rc" && npm test')).toBe('other');
    // typographic quotes are quotes, typographic dashes are dashes
    expect(ps('cd \u2018src\u2019 && npm test')).toBe('other');
    expect(ps('npm test \u2013t x')).toBe('other');
    // splatting and arrays
    expect(ps('npm test @args')).toBe('other');
    expect(ps('npx vitest run a.ts,b.ts')).toBe('other');
    expect(callShape('npm test', 'cmd').kind).toBe('other');
  });

  it('outside: anything else in the call, any other flag, any expansion', () => {
    for (const cmd of [
      // N1: a subshell; N2's relatives: chains, conditionals, the directory stack
      "cd OTHER && (true; cd REPO; true); npm test",
      'cd x; npm test',
      'cd x || cd y; npm test',
      'false && cd x; npm test',
      'cd a && cd b && npm test',
      'pushd x && npm test; popd',
      'if true; then cd x; fi; npm test',
      'cd x | cat; npm test',
      'npm test; npm test',
      'git -C OTHER status && npm test',
      'cd <REPO> && git ls-files && npx vitest run 2>&1 | tail -40',
      // variables, home, globs, substitutions
      'D=../x; cd $D && npm test',
      'cd ~/repo && npm test',
      'cd "$HOME/repo" && npm test',
      'cd `pwd` && npm test',
      'npx vitest run src/*.test.ts',
      // N3: flags that move the run elsewhere, or unknown ones
      'npm test --prefix ../other',
      'npm --prefix ../other test',
      'pytest --rootdir=../other',
      'pytest -c ../other/pytest.ini',
      'npx vitest run --root ../other',
      'npx vitest run --config other.config.ts',
      'pnpm --dir ../other test',
      'yarn --cwd ../other test',
      'npx jest --rootDir ../x',
      'pytest -p no:cacheprovider',
      'npx vitest run -u',
      // redirections other than 2>&1, background
      'npm test > out.log',
      'npm test &',
      'npm test 2>&1 >/dev/null',
    ]) {
      expect([cmd, shape(cmd).kind]).toEqual([cmd, 'other']);
    }
  });

  it('what may move the shell (for the session cwd that Claude Code keeps between calls)', () => {
    expect(shape('cd x; ls')).toEqual({ kind: 'other', movesShell: true });
    expect(shape('pushd x')).toEqual({ kind: 'other', movesShell: true });
    expect(shape('source env.sh')).toEqual({ kind: 'other', movesShell: true });
    expect(shape('(cd x)')).toEqual({ kind: 'other', movesShell: true });
    expect(shape('ls -la && git status')).toEqual({ kind: 'other', movesShell: false });
  });

  it('closed lists have no back doors (eighth review: R1, R2, R3, R7)', () => {
    // `VAR=v`: only innocuous variables, only in POSIX shells. PYTEST_ADDOPTS or VITEST_* change what runs.
    expect(shape('CI=1 npm test').kind).toBe('run');
    expect(shape('CI=1 FORCE_COLOR=0 npm test').kind).toBe('run');
    expect(shape('NO_COLOR=1 npm test').kind).toBe('other');
    for (const cmd of [
      'PYTEST_ADDOPTS="-k a" python -m pytest',
      'VITEST_MODE=x npx vitest run',
      'NODE_OPTIONS=--require=x npm test',
      'CI=1 PYTEST_ADDOPTS=-x pytest',
    ]) {
      expect([cmd, shape(cmd).kind]).toEqual([cmd, 'other']);
    }
    // In PowerShell `VAR=v cmd` is not an assignment: it runs a command named `VAR=v`.
    expect(shape('CI=1 npm test', 'powershell').kind).toBe('other');
    // Filters read only the pipe: a file argument, or a flag outside the list, may print anything.
    for (const cmd of [
      'npm test | head -20 old.log',
      'npm test | tail -n 5 old.log',
      'npm test | grep passed old.log',
      'npm test | grep -e passed -e failed',
      'npm test | grep -o passed',
      'npm test | grep -r passed',
      'npm test | head -c 100',
      'npm test | tee -p out.log',
    ]) {
      expect([cmd, shape(cmd).kind]).toEqual([cmd, 'other']);
    }
    for (const cmd of ['npm test | head -20', 'npm test | tail -n 5', 'npm test | grep -E -i -A 2 passed', 'npm test | grep -e passed']) {
      expect([cmd, shape(cmd).kind]).toEqual([cmd, 'run']);
    }
    // PowerShell's Set-Location reads `[`, `]`, `*` and `?` as a wildcard pattern.
    expect(shape("cd 'sub1' && npm test", 'powershell').kind).toBe('run');
    expect(shape("cd 'sub[1]' && npm test", 'powershell').kind).toBe('other');
    expect(shape("Set-Location 'a*' && npm test", 'powershell').kind).toBe('other');
    // Ninth review, F1: standalone too (the next call runs where the wildcard matched), so the shell is lost.
    expect(shape("cd 'C:/work/ps-wild[1]/repo'", 'powershell')).toEqual({ kind: 'other', movesShell: true });
    expect(shape("cd '/work/ps-wild[1]/repo'")).toEqual({ kind: 'cd', dir: '/work/ps-wild[1]/repo' });
    expect(shape("cd 'sub[1]' && npm test").kind).toBe('run');
  });
});
