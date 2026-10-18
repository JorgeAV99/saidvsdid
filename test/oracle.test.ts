// The runner-evidence oracle (fixtures/oracle.ts): each FAIL effect asks for its own evidence, and a bare failure is
// never evidence of an expected failure (a test broken by the code fails too).
import { describe, expect, it } from 'vitest';
import { listCases } from '../fixtures/build.js';
import { expectedFailures, lostTests, missingEvidence, runnerKeys, type Statuses } from '../fixtures/oracle.js';

describe('the oracle of a FAIL', () => {
  it('not-run: a test that ran at base no longer runs at head', () => {
    expect(missingEvidence('not-run', { a: 'passed' }, { a: 'skipped' })).toBeNull();
    expect(missingEvidence('not-run', { a: 'passed', b: 'passed' }, { b: 'passed' })).toBeNull();
    expect(missingEvidence('not-run', { a: 'passed' }, { a: 'passed' })).not.toBeNull();
    expect(missingEvidence('not-run', { a: 'passed' }, { a: 'failed' })).not.toBeNull();
    expect(lostTests({ a: 'passed' }, { b: 'passed' })).toEqual([]); // a rename
  });

  it('expected-failure: only the runner\'s explicit signal, never a bare failure', () => {
    expect(missingEvidence('expected-failure', { a: 'passed' }, { a: 'xpassed' })).toBeNull();
    expect(missingEvidence('expected-failure', { a: 'failed' }, { a: 'xfailed' })).toBeNull();
    expect(missingEvidence('expected-failure', { a: 'failed' }, { a: 'xpassed' })).toBeNull(); // a strict XPASS relaxed
    expect(missingEvidence('expected-failure', { a: 'passed' }, { a: 'failed' })).not.toBeNull();
    expect(missingEvidence('expected-failure', { a: 'passed' }, { a: 'skipped' })).not.toBeNull();
    expect(missingEvidence('expected-failure', { a: 'xfailed' }, { a: 'xfailed' })).not.toBeNull(); // nothing changed
    expect(expectedFailures({}, { a: 'xfailed' })).toEqual(['a']);
  });

  it('an expected failure ran: passed → xpassed is never evidence that a test stopped running', () => {
    expect(missingEvidence('not-run', { a: 'passed' }, { a: 'xpassed' })).not.toBeNull();
    expect(missingEvidence('not-run', { a: 'passed' }, { a: 'xfailed' })).not.toBeNull();
    expect(missingEvidence('not-run', { a: 'xpassed' }, { a: 'skipped' })).toBeNull();
    expect(lostTests({ a: 'xpassed' }, {})).toEqual(['a']);
  });

  it('statuses are read by own property: a test titled like a member of Object.prototype is a test, and none is inherited', () => {
    // Statuses as a runner's JSON gives them: own keys, whatever their names.
    const st = (json: string): Statuses => JSON.parse(json) as Statuses;
    // Renamed away from 'constructor': with `in`, 'constructor' would look present at head and stopped.
    expect(lostTests(st('{"constructor":"passed"}'), st('{"builds":"passed"}'))).toEqual([]);
    // Renamed to 'toString': with `in`, 'toString' would look present at base, and 'adds' lost.
    expect(lostTests(st('{"adds":"passed"}'), st('{"toString":"passed"}'))).toEqual([]);
    expect(lostTests(st('{"constructor":"passed"}'), st('{"constructor":"skipped"}'))).toEqual(['constructor']);
    expect(lostTests(st('{"__proto__":"passed"}'), {})).toEqual(['__proto__']);
    expect(expectedFailures(st('{"constructor":"xfailed"}'), st('{"constructor":"xfailed"}'))).toEqual([]);
    expect(expectedFailures({}, st('{"hasOwnProperty":"xfailed"}'))).toEqual(['hasOwnProperty']);
  });

  // A recorded key, as the recorder writes it: the JSON array [file, name, ordinal].
  const k = (file: string, name: string, ordinal = 1): string => JSON.stringify([file, name, ordinal]);

  it('a FAIL is credited with the status of the tests it names, never another test\'s', () => {
    // Codex's pair: test_real passed → skipped, test_fake passed → passed. The whole fixture shows a lost test; test_fake's
    // own status does not.
    const base = { [k('test_a.py', 'test_real')]: 'passed', [k('test_a.py', 'test_fake')]: 'passed' } as const;
    const head = { [k('test_a.py', 'test_real')]: 'skipped', [k('test_a.py', 'test_fake')]: 'passed' } as const;
    expect(missingEvidence('not-run', base, head)).toBeNull();
    expect(missingEvidence('not-run', base, head, [k('test_a.py', 'test_real')])).toBeNull();
    expect(missingEvidence('not-run', base, head, [k('test_a.py', 'test_fake')])).not.toBeNull();
    expect(missingEvidence('expected-failure', { a: 'passed', b: 'passed' }, { a: 'xfailed', b: 'passed' }, ['b'])).not.toBeNull();
    expect(runnerKeys('pytest', 'test_a.py', ['test_real', 1], [base, head])).toEqual([k('test_a.py', 'test_real')]);
    expect(runnerKeys('pytest', 'test_a.py', ['test_x', 1], [{ [k('test_a.py', 'test_x[1]')]: 'passed', [k('test_a.py', 'test_x[2]')]: 'passed', [k('test_a.py', 'test_xy')]: 'passed' }])).toEqual([k('test_a.py', 'test_x[1]'), k('test_a.py', 'test_x[2]')]);
    expect(runnerKeys('vitest', 'test/a.test.ts', ['group > adds', 1], [{ [k('test/a.test.ts', 'group > adds')]: 'passed', [k('test/a.test.ts', 'adds')]: 'passed' }])).toEqual([k('test/a.test.ts', 'group > adds')]);
  });

  it("a FAIL is credited with its own file's tests alone, never another file's or the complement of the fixture (Codex 15, 10a)", () => {
    // A focus in a.test.ts and a skip in c.test.ts: C stops running, but the focus is about a.test.ts's tests.
    const base = { [k('test/a.test.ts', 'A')]: 'passed', [k('test/a.test.ts', 'B')]: 'skipped', [k('test/c.test.ts', 'C')]: 'passed' } as const;
    const head = { [k('test/a.test.ts', 'A')]: 'passed', [k('test/a.test.ts', 'B')]: 'skipped', [k('test/c.test.ts', 'C')]: 'skipped' } as const;
    expect(runnerKeys('vitest', 'test/a.test.ts', ['C', 1], [base, head])).toEqual([]);
    expect(runnerKeys('vitest', 'test/a.test.ts', ['B', 1], [base, head])).toEqual([k('test/a.test.ts', 'B')]);
    expect(missingEvidence('not-run', base, head, runnerKeys('vitest', 'test/a.test.ts', ['B', 1], [base, head]))).not.toBeNull();
    expect(missingEvidence('not-run', base, head, runnerKeys('vitest', 'test/c.test.ts', ['C', 1], [base, head]))).toBeNull();
  });

  it('identities are structured: a title `X#2` never collides with the second `X` (Codex 16, 8)', () => {
    const fixture = listCases().find((c) => c.id === 'TG003/codex16-title-hash-collision-vitest')!;
    const { base, head } = fixture.runnerEvidence!;
    // Three tests, three keys: the second X is xpassed, the title `X#2` passed.
    expect(head[k('test/a.test.ts', 'X', 2)]).toBe('xpassed');
    expect(head[k('test/a.test.ts', 'X#2')]).toBe('passed');
    expect(Object.keys(head)).toHaveLength(3);
    // `X` is repeated in the file: no finding about it is ever credited; `X#2` is a test of its own.
    expect(runnerKeys('vitest', 'test/a.test.ts', ['X', 2], [base, head])).toEqual([]);
    expect(runnerKeys('vitest', 'test/a.test.ts', ['X#2', 1], [base, head])).toEqual([k('test/a.test.ts', 'X#2')]);
  });

  it('a name the file repeats, on either side, is never credited: an ordinal that shifts is not evidence (Codex 15, 10b; Codex 16, 8)', () => {
    // A new X inserted before an existing `test.fails('X')`: its ordinal moves from 2 to 3, the expected failure is not new.
    const fixture = listCases().find((c) => c.id === 'TG003/codex16-ordinal-shift-vitest')!;
    const { base, head } = fixture.runnerEvidence!;
    for (const n of [1, 2, 3]) expect(runnerKeys('vitest', 'test/a.test.ts', ['X', n], [base, head])).toEqual([]);
    // Two X at base only: the same.
    expect(runnerKeys('vitest', 'test/a.test.ts', ['X', 1], [{ [k('test/a.test.ts', 'X')]: 'passed', [k('test/a.test.ts', 'X', 2)]: 'passed' }, { [k('test/a.test.ts', 'X')]: 'skipped' }])).toEqual([]);
    const dup = listCases().find((c) => c.id === 'TG003/codex15-duplicate-titles-vitest')!;
    expect(Object.keys(dup.runnerEvidence!.head).sort()).toEqual([k('test/a.test.ts', 'X'), k('test/a.test.ts', 'X', 2)]);
    expect(runnerKeys('vitest', 'test/a.test.ts', ['X', 2], [dup.runnerEvidence!.base, dup.runnerEvidence!.head])).toEqual([]);
  });

  it('an expected failure is new only when the test was not one at base: xpassed → xfailed is the same one', () => {
    expect(missingEvidence('expected-failure', { a: 'xpassed' }, { a: 'xfailed' })).not.toBeNull();
    expect(missingEvidence('expected-failure', { a: 'xfailed' }, { a: 'xpassed' })).not.toBeNull();
    expect(missingEvidence('expected-failure', { a: 'passed' }, { a: 'xfailed' })).toBeNull();
    const control = listCases().find((c) => c.id === 'TG003/codex14-oracle-control-fails-already-present-vitest')!;
    const x = k('test/a.test.ts', 'X');
    expect(control.runnerEvidence!.base[x]).toBe('xpassed');
    expect(control.runnerEvidence!.head[x]).toBe('xfailed');
    expect(missingEvidence('expected-failure', control.runnerEvidence!.base, control.runnerEvidence!.head)).not.toBeNull();
  });

  it('the not-run controls with the real runners: every test still runs, and the oracle finds none lost', () => {
    const controls = listCases().filter((c) => c.oracleControl === 'not-run');
    expect(controls.map((c) => c.id).sort()).toEqual([
      'TG003/oracle-control-constructor-renamed-vitest',
      'TG003/oracle-control-node-todo-runs',
      'TG003/oracle-control-to-string-appears-vitest',
    ]);
    for (const c of controls) {
      const { base, head } = c.runnerEvidence!;
      expect(lostTests(base, head), c.id).toEqual([]);
    }
    // node:test's todo ran its body: the runner's todo signal, recorded as xpassed, is the evidence of its effect.
    const todo = controls.find((c) => c.id === 'TG003/oracle-control-node-todo-runs')!;
    expect(todo.runnerEvidence!.head[k('test/a.test.mjs', 'adds')]).toBe('xpassed');
    expect(missingEvidence('expected-failure', todo.runnerEvidence!.base, todo.runnerEvidence!.head)).toBeNull();
  });

  it('unittest, aggregated per test (Codex 17): a subtest is its test\'s, a later skip never hides a failure, a class skipped from setUpClass is skipped', () => {
    const ev = (id: string): { base: Statuses; head: Statuses } => listCases().find((c) => c.id === id)!.runnerEvidence!;
    const parent = k('tests/test_a.py', 'TestX::test_x');
    // A skipped subtest while another case still runs: the test keeps its identity and ran; each subtest is a child.
    for (const id of ['TG003/codex17-unittest-subtest-skip-partial', 'TG003/codex17-unittest-subtest-skip-all']) {
      const { base, head } = ev(id);
      expect(head[parent], id).toBe('passed');
      expect(head[k('tests/test_a.py', 'TestX::test_x (x=1)')], id).toBe('skipped');
      expect(Object.keys(head).every((t) => t.startsWith('["tests/test_a.py"')), id).toBe(true);
      expect(missingEvidence('not-run', base, head, [parent]), id).not.toBeNull();
    }
    expect(ev('TG003/codex17-unittest-subtest-skip-all').head[k('tests/test_a.py', 'TestX::test_x (x=2)')]).toBe('skipped');
    // A skip after a failed subtest: failed on both sides, never evidence that the test stopped.
    const after = ev('TG003/codex17-unittest-skip-after-subtest-failure');
    expect([after.base[parent], after.head[parent]]).toEqual(['failed', 'failed']);
    expect(missingEvidence('not-run', after.base, after.head, [parent])).not.toBeNull();
    // A class skipped from setUpClass, a module from setUpModule: each of their test methods, skipped; another's runs.
    const cls = ev('TG003/codex17-unittest-setupclass-skip');
    expect(cls.head[parent]).toBe('skipped');
    expect(missingEvidence('not-run', cls.base, cls.head, [parent])).toBeNull();
    const mod = ev('TG003/codex17-unittest-setupmodule-skip');
    expect(Object.entries(mod.head).sort()).toEqual([
      [k('tests/test_a.py', 'TestX::test_x'), 'skipped'],
      [k('tests/test_a.py', 'TestX::test_y'), 'skipped'],
      [k('tests/test_a.py', 'TestY::test_z'), 'skipped'],
      [k('tests/test_b.py', 'TestB::test_b'), 'passed'],
    ]);
    // Any other error there fails them; a teardown's error after they ran fails them, a teardown's SkipTest keeps them.
    expect(Object.values(ev('TG003/codex17-unittest-setupclass-error').head)).toEqual(['failed', 'failed']);
    expect(ev('TG003/codex17-unittest-teardownclass-error').head[parent]).toBe('failed');
    expect(ev('TG003/codex17-unittest-teardownmodule-error').head[parent]).toBe('failed');
    expect(ev('TG003/codex17-unittest-teardownclass-skip').head[parent]).toBe('passed');
    // A tearDownClass error keeps a skipped test skipped; only the one that ran fails (Codex 18).
    const keeps = ev('TG003/codex18-unittest-teardownclass-error-keeps-skip');
    expect([keeps.head[k('tests/test_a.py', 'TestX::test_a')], keeps.head[k('tests/test_a.py', 'TestX::test_b')]]).toEqual(['skipped', 'failed']);
  });

  it('unittest, one record per execution: `load_tests` running a method twice keeps both, and the oracle never credits the name (Codex 18, 1)', () => {
    const { base, head } = listCases().find((c) => c.id === 'TG003/codex18-unittest-load-tests-repeated')!.runnerEvidence!;
    expect([base[k('tests/test_a.py', 'TestX::test_x', 1)], base[k('tests/test_a.py', 'TestX::test_x', 2)]]).toEqual(['passed', 'passed']);
    expect([head[k('tests/test_a.py', 'TestX::test_x', 1)], head[k('tests/test_a.py', 'TestX::test_x', 2)]]).toEqual(['passed', 'skipped']);
    expect(runnerKeys('unittest', 'tests/test_a.py', ['TestX::test_x', 1], [base, head])).toEqual([]);
    expect(runnerKeys('unittest', 'tests/test_a.py', ['TestX::test_x', 2], [base, head])).toEqual([]);
  });

  it('the negative controls with the real runners: code broken, test untouched, passed → failed without the signal', () => {
    const controls = listCases().filter((c) => c.oracleControl === 'expected-failure' && c.id.includes('oracle-control-broken-code'));
    expect(new Set(controls.map((c) => c.runner))).toEqual(new Set(['vitest', 'jest', 'pytest', 'unittest']));
    for (const c of controls) {
      const { base, head } = c.runnerEvidence!;
      const broken = Object.keys(base).filter((t) => base[t] === 'passed' && head[t] === 'failed');
      expect(broken, c.id).not.toEqual([]);
      expect(missingEvidence('expected-failure', base, head), c.id).not.toBeNull();
    }
  });
});
