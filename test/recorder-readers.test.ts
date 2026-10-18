// The recorder fails closed (scripts/recorder-readers.mjs): a result it cannot represent exactly stops the recording
// with `unrecordable: <reason>`; it never approximates, merges or reduces one, and the statuses it rebuilds are
// evidence only once the runner's own summary of the same run agrees with them. Synthetic reports, one per form; the
// real runners' refusals are the `unrecordable` fixtures, re-checked in CI by `node scripts/runner-evidence.mjs --check`.
import { describe, expect, it } from 'vitest';
import { readJest, readNode, readPlaywright, readReply, readVitest, vitestFailsWithExtend } from '../scripts/recorder-readers.mjs';

const DIR = '/side';
// Playwright's step reporter: no expected-failure test with a hook or fixture failure.
const STEPS = { others: 0 };
const k = (file: string, name: string, n = 1): string => JSON.stringify([file, name, n]);

// Playwright: tests, and the report's own stats counted from their outcomes (or given).
const pwTest = (over: Record<string, unknown>) => ({ status: 'expected', expectedStatus: 'passed', results: [{ status: 'passed' }], ...over });
const pw = (tests: Record<string, unknown>[], stats?: Record<string, number>) => {
  const counted: Record<string, number> = { 'expected': 0, 'unexpected': 0, 'flaky': 0, 'skipped': 0 };
  for (const t of tests) counted[String(t['status'])] = (counted[String(t['status'])] ?? 0) + 1;
  return { suites: [{ title: 'a.spec.mjs', specs: [{ title: 'X', tests }] }], stats: stats ?? counted };
};

// Jest: one test, and the report's own counts (or given).
const jestReport = (status: string, over: Record<string, unknown> = {}, counts?: Record<string, unknown>) => {
  const key = status === 'pending' || status === 'skipped' || status === 'disabled' ? 'numPendingTests' : status === 'todo' ? 'numTodoTests' : status === 'failed' ? 'numFailedTests' : 'numPassedTests';
  const native: Record<string, unknown> = { 'numTotalTests': 1, 'numPassedTests': 0, 'numFailedTests': 0, 'numPendingTests': 0, 'numTodoTests': 0, 'numRuntimeErrorTestSuites': 0, 'success': status !== 'failed' };
  native[key] = 1;
  return { testResults: [{ name: '/side/a.test.js', status: status === 'failed' ? 'failed' : 'passed', assertionResults: [{ ancestorTitles: [], title: 'X', status, invocations: 1, ...over }] }], ...native, ...counts };
};

// Vitest: one test in the JSON, its reporter-API row, and the JSON's own counts (or given).
const vitestReport = (status: string, counts?: Record<string, unknown>) => {
  const key = status === 'skipped' ? 'numPendingTests' : status === 'todo' ? 'numTodoTests' : status === 'failed' ? 'numFailedTests' : status === 'passed' ? 'numPassedTests' : null;
  const native: Record<string, unknown> = { 'numTotalTests': 1, 'numPassedTests': 0, 'numFailedTests': 0, 'numPendingTests': 0, 'numTodoTests': 0, 'success': status !== 'failed' };
  if (key) native[key] = 1;
  return { testResults: [{ name: '/side/a.test.ts', assertionResults: [{ ancestorTitles: [], title: 'X', status }] }], ...native, ...counts };
};
const api = (state: string, mode = 'run', inverted = false, raw: string | null = 'pass', retryCount: number | null = 0, repeatCount: number | null = 0, observed: unknown = null) => [['/side/a.test.ts', 'X', inverted, state, mode, raw, retryCount, repeatCount, observed]];
// What the observing runner saw of a test's body: its own outcome, the errors right after it and at its end.
const seen = (body: string, afterBody: number | null, atEnd: number | null) => ({ body, afterBody, atEnd });

// node:test: the reporter's reply, with each file's own summary and the run's.
const nodeReply = (statuses: Record<string, string>, counts: Record<string, number>, success = true) => ({
  tests: Object.fromEntries(Object.entries(statuses).map(([name, status]) => [k('test/a.test.mjs', name), status])),
  files: [{ file: 'test/a.test.mjs', counts: { 'tests': 0, 'passed': 0, 'failed': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0, ...counts } }],
  run: { counts: { 'tests': 0, 'passed': 0, 'failed': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0, ...counts }, success },
});

describe('the recorder fails closed', () => {
  it('Playwright: one execution per test; a retry is refused, never read as one outcome (Codex 18, 2)', () => {
    expect(readPlaywright(pw([pwTest({})]), DIR, 0, STEPS).get(k('a.spec.mjs', 'X'))).toBe('passed');
    // `test.describe.configure({ retries: 1 })` on a `test.fail`: passed, then failed; Playwright says `flaky`.
    const flaky = pwTest({ status: 'flaky', expectedStatus: 'failed', results: [{ status: 'passed' }, { status: 'failed' }] });
    expect(() => readPlaywright(pw([flaky]), DIR, 0, STEPS)).toThrow('unrecordable: retries');
    // Two attempts whatever the outcome Playwright gives them.
    expect(() => readPlaywright(pw([pwTest({ status: 'unexpected', results: [{ status: 'failed' }, { status: 'failed' }] })]), DIR, 1, STEPS)).toThrow('unrecordable: retries');
    expect(() => readPlaywright(pw([pwTest({ status: 'unknown-outcome' })]), DIR, 0, STEPS)).toThrow('unrecordable: playwright outcome');
    expect(() => readPlaywright(pw([pwTest({ expectedStatus: 'timedOut' })]), DIR, 0, STEPS)).toThrow('unrecordable: playwright expected status');
    expect(() => readPlaywright(pw([pwTest({ results: [] })]), DIR, 0, STEPS)).toThrow('unrecordable: playwright: an outcome with no run');
    expect(readPlaywright(pw([pwTest({ status: 'skipped', expectedStatus: 'skipped', results: [] })]), DIR, 0, STEPS).get(k('a.spec.mjs', 'X'))).toBe('skipped');
  });

  it('Playwright: its own stats and exit code must agree with the outcomes (round 19)', () => {
    expect(() => readPlaywright(pw([pwTest({})], { 'expected': 1, 'unexpected': 0, 'flaky': 1, 'skipped': 0 }), DIR, 0, STEPS)).toThrow('unrecordable: playwright: its own summary disagrees with the results (flaky');
    expect(() => readPlaywright(pw([pwTest({})], { 'expected': 2, 'unexpected': 0, 'flaky': 0, 'skipped': 0 }), DIR, 0, STEPS)).toThrow('unrecordable: playwright: its own summary disagrees');
    expect(() => readPlaywright({ suites: [] }, DIR, 0, STEPS)).toThrow('unrecordable: playwright: its own summary cannot be read');
    expect(() => readPlaywright(pw([pwTest({})]), DIR, 1, STEPS)).toThrow('unrecordable: playwright: exit 1 against its own summary');
    expect(readPlaywright(pw([pwTest({ status: 'unexpected', results: [{ status: 'failed' }] })]), DIR, 1, STEPS).get(k('a.spec.mjs', 'X'))).toBe('failed');
  });

  it('Jest: a status it does not know (`focused`, anything else) is refused, never mapped to passed', () => {
    expect(readJest(jestReport('pending'), DIR, 0).get(k('a.test.js', 'X'))).toBe('skipped');
    expect(() => readJest(jestReport('focused'), DIR, 0)).toThrow('unrecordable: jest status "focused"');
    expect(() => readJest(jestReport('constructor'), DIR, 0)).toThrow('unrecordable: jest status');
  });

  it('Jest: a test run more than once, or counts and an exit code that disagree with its own summary, are refused (Codex 19, 3)', () => {
    // `jest.retryTimes(1)` with `test.failing`: the body passes, then fails; Jest says `invocations: 2`.
    expect(() => readJest(jestReport('passed', { 'invocations': 2, 'failing': true }), DIR, 0)).toThrow('unrecordable: jest: a test run more than once');
    expect(() => readJest(jestReport('passed', { 'invocations': undefined }), DIR, 0)).toThrow('unrecordable: jest: its own summary cannot be read (invocations)');
    expect(() => readJest(jestReport('passed', {}, { 'numPassedTests': 0 }), DIR, 0)).toThrow('unrecordable: jest: its own summary disagrees with the results (passed');
    expect(() => readJest(jestReport('passed', {}, { 'numTotalTests': undefined }), DIR, 0)).toThrow('unrecordable: jest: its own summary cannot be read (numTotalTests)');
    expect(() => readJest(jestReport('passed'), DIR, 1)).toThrow('unrecordable: jest: exit 1 against its own summary');
    expect(() => readJest(jestReport('failed', {}, { 'success': true }), DIR, 0)).toThrow('unrecordable: jest: a failed test in a run it calls successful');
    expect(readJest(jestReport('failed'), DIR, 1).get(k('a.test.js', 'X'))).toBe('failed');
  });

  it('Vitest: a test that did not finish, an unknown status, or a report that disagrees with the reporter API is refused', () => {
    expect(readVitest(vitestReport('passed'), api('passed'), DIR, 0).get(k('a.test.ts', 'X'))).toBe('passed');
    expect(readVitest(vitestReport('passed'), api('passed', 'run', true, 'pass', 0, 0, seen('failed', 1, 1)), DIR, 0).get(k('a.test.ts', 'X'))).toBe('xfailed');
    expect(readVitest(vitestReport('todo'), api('skipped', 'todo'), DIR, 0).get(k('a.test.ts', 'X'))).toBe('todo');
    // `pending`: never started (no result: a `test.only` inside a `describe.skip`) did not run; started or queued and
    // unfinished is refused.
    expect(readVitest(vitestReport('pending'), api('pending', 'only', false, null, null, null), DIR, 0).get(k('a.test.ts', 'X'))).toBe('skipped');
    expect(() => readVitest(vitestReport('pending'), api('pending', 'run', false, 'run'), DIR, 0)).toThrow('unrecordable: vitest: a test that did not finish');
    expect(() => readVitest(vitestReport('pending'), api('pending', 'run', false, 'queued'), DIR, 0)).toThrow('unrecordable: vitest: a test that did not finish');
    expect(() => readVitest(vitestReport('disabled'), api('skipped'), DIR, 0)).toThrow('unrecordable: vitest status');
    // Vitest's JSON maps a state it does not know to `skipped`: the reporter API must say skipped too.
    expect(() => readVitest(vitestReport('skipped'), api('pending'), DIR, 0)).toThrow('unrecordable: vitest: status skipped');
    expect(() => readVitest(vitestReport('passed'), [], DIR, 0)).toThrow('unrecordable: vitest: its JSON report and its reporter API disagree');
    expect(() => readVitest({ testResults: [] }, api('passed'), DIR, 0)).toThrow('unrecordable: vitest: its JSON report and its reporter API disagree');
  });

  it('Vitest: a retry or a repeat, or counts and an exit code that disagree with its own summary, are refused (Codex 19, 3)', () => {
    expect(() => readVitest(vitestReport('passed'), api('passed', 'run', false, 'pass', 1, 0), DIR, 0)).toThrow('unrecordable: vitest: a test run more than once');
    expect(() => readVitest(vitestReport('passed'), api('passed', 'run', false, 'pass', 0, 1), DIR, 0)).toThrow('unrecordable: vitest: a test run more than once');
    expect(() => readVitest(vitestReport('passed', { 'numPassedTests': 2 }), api('passed'), DIR, 0)).toThrow('unrecordable: vitest: its own summary disagrees with the results (passed');
    expect(() => readVitest(vitestReport('passed'), api('passed'), DIR, 1)).toThrow('unrecordable: vitest: exit 1 against its own summary');
    expect(() => readVitest(vitestReport('failed', { 'success': true }), api('failed', 'run', false, 'fail'), DIR, 0)).toThrow('unrecordable: vitest: a failed test in a run it calls successful');
    expect(readVitest(vitestReport('failed'), api('failed', 'run', false, 'fail'), DIR, 1).get(k('a.test.ts', 'X'))).toBe('failed');
  });

  it('node:test: a cancelled test, or counts and an exit code that disagree with its own summary, are refused (Codex 19, 2)', () => {
    expect(readNode(nodeReply({ a: 'passed', b: 'failed', c: 'skipped', d: 'xfailed' }, { 'tests': 4, 'passed': 1, 'failed': 1, 'skipped': 1, 'todo': 1 }, false), 1)[k('test/a.test.mjs', 'c')]).toBe('skipped');
    // `{ signal: AbortSignal.abort() }`: Node counts the test cancelled; the reporter saw a failure.
    expect(() => readNode(nodeReply({ a: 'failed' }, { 'tests': 1, 'cancelled': 1 }, false), 1)).toThrow('unrecordable: node:test: a cancelled test');
    expect(() => readNode(nodeReply({ a: 'passed' }, { 'tests': 1, 'failed': 1 }, false), 1)).toThrow('unrecordable: node:test: its own summary disagrees with the results (passed');
    expect(() => readNode(nodeReply({ a: 'passed' }, { 'tests': 1, 'passed': 1 }), 1)).toThrow('unrecordable: node:test: exit 1 against its own summary');
    expect(() => readNode({ ...nodeReply({ a: 'passed' }, { 'tests': 1, 'passed': 1 }), files: [] }, 0)).toThrow('unrecordable: node:test: a file with no summary of its own');
    expect(() => readNode({ ...nodeReply({ a: 'passed' }, { 'tests': 1, 'passed': 1 }), run: null }, 0)).toThrow('unrecordable: node:test: its own summary cannot be read');
  });

  it('an inverted status only from the runner\'s own signal, with no other failure in the same test (round 20)', () => {
    // Jest `failing`: passed is the body failing and nothing else; failed is xpassed only with Jest's own message alone.
    const passedMessage = 'Failing test passed even though it was supposed to fail. Remove `.failing` to remove error.';
    expect(readJest(jestReport('passed', { 'failing': true, 'failureMessages': [], 'failureDetails': [] }), DIR, 0).get(k('a.test.js', 'X'))).toBe('xfailed');
    expect(() => readJest(jestReport('passed', { 'failing': true, 'failureMessages': ['Error: x'], 'failureDetails': [{}] }), DIR, 0)).toThrow('unrecordable: jest: an expected failure with another failure');
    const own = { 'failing': true, 'failureMessages': [`Error: ${passedMessage}\n    at failing`], 'failureDetails': [{ 'message': passedMessage }] };
    expect(readJest(jestReport('failed', own), DIR, 1).get(k('a.test.js', 'X'))).toBe('xpassed');
    // Codex 20: the body fails as expected and `afterEach` throws — the hook's error alone.
    const hook = { 'failing': true, 'failureMessages': ['Error: cleanup failed\n    at afterEach'], 'failureDetails': [{}] };
    expect(() => readJest(jestReport('failed', hook), DIR, 1)).toThrow('unrecordable: jest: an expected failure with another failure in the same test');
    // The body passes and `afterEach` throws: Jest's message and the hook's.
    const both = { 'failing': true, 'failureMessages': [own.failureMessages[0], hook.failureMessages[0]], 'failureDetails': [{ 'message': passedMessage }, {}] };
    expect(() => readJest(jestReport('failed', both), DIR, 1)).toThrow('unrecordable: jest: an expected failure with another failure');
    const count = { 'failing': true, 'failureMessages': ['Error: expect.assertions(1)'], 'failureDetails': [{ 'message': 'expect.assertions(1)' }] };
    expect(() => readJest(jestReport('failed', count), DIR, 1)).toThrow('unrecordable: jest: an expected failure with another failure');
    expect(() => readJest(jestReport('failed', { 'failing': true }), DIR, 1)).toThrow('unrecordable: jest: an expected failure with another failure');

    // Vitest `fails`: what the observing runner saw before Vitest inverted the whole test.
    const vitest = (status: string, observed: unknown) => readVitest(vitestReport(status), api(status, 'run', true, status === 'passed' ? 'pass' : 'fail', 0, 0, observed), DIR, status === 'passed' ? 0 : 1).get(k('a.test.ts', 'X'));
    expect(vitest('passed', seen('failed', 1, 1))).toBe('xfailed');
    expect(vitest('failed', seen('passed', 0, 0))).toBe('xpassed');
    // Codex 20c: `expect.soft` and `expect.assertions(2)`, two errors before the inversion; or two `expect.soft`.
    expect(() => vitest('passed', seen('failed', 2, 2))).toThrow('unrecordable: vitest: an expected failure with another failure in the same test');
    expect(() => vitest('passed', seen('passed', 0, 1))).toThrow('unrecordable: vitest: an expected failure with another failure in the same test'); // afterEach
    expect(() => vitest('passed', seen('failed', 1, 2))).toThrow('unrecordable: vitest: an expected failure with another failure'); // body and afterEach
    expect(() => vitest('passed', seen('not-run', 1, 1))).toThrow('unrecordable: vitest: an expected failure with another failure'); // beforeEach
    expect(() => vitest('failed', seen('not-run', null, null))).toThrow('unrecordable: vitest: an expected failure with another failure');
    expect(() => vitest('passed', null)).toThrow('unrecordable: vitest: an expected failure with another failure'); // not observed

    // Playwright `test.fail`: a hook or fixture step that failed in an expected-failure test.
    const fail = pwTest({ expectedStatus: 'failed', results: [{ status: 'failed', errors: [{}] }] });
    expect(readPlaywright(pw([fail]), DIR, 0, STEPS).get(k('a.spec.mjs', 'X'))).toBe('xfailed');
    // Two `expect.soft` failures under `test.fail`: two errors in the result.
    const twoSoft = pwTest({ expectedStatus: 'failed', results: [{ status: 'failed', errors: [{}, {}] }] });
    expect(() => readPlaywright(pw([twoSoft]), DIR, 0, STEPS)).toThrow('unrecordable: playwright: an expected failure with another failure in the same test');
    const passedBody = pwTest({ status: 'unexpected', expectedStatus: 'failed', results: [{ status: 'passed', errors: [] }] });
    expect(readPlaywright(pw([passedBody]), DIR, 1, STEPS).get(k('a.spec.mjs', 'X'))).toBe('xpassed');
    expect(() => readPlaywright(pw([fail]), DIR, 0, { others: 1 })).toThrow('unrecordable: playwright: an expected failure with another failure in the same test');
    expect(() => readPlaywright(pw([fail]), DIR, 0, null)).toThrow('unrecordable: playwright: no step report');
  });

  it('Vitest: an extended test API with a `fails` test anywhere in the side is refused, statically (round 20b)', () => {
    const extended = "import { test as base } from 'vitest';\nexport const test = base.extend({ res: async ({}, use) => use(1) });\n";
    expect(vitestFailsWithExtend([extended + "test.fails('x', ({ res }) => {});\n"])).toBe(true);
    expect(vitestFailsWithExtend([extended, "import { test } from './fx';\ntest('x', { fails: true }, () => {});\n"])).toBe(true); // a helper's
    expect(vitestFailsWithExtend(["const test = it.extend({});\ntest.fails('x', () => {});\n"])).toBe(true);
    expect(vitestFailsWithExtend([extended + "test('x', ({ res }) => {});\n"])).toBe(false);
    expect(vitestFailsWithExtend(["import { test } from 'vitest';\ntest.fails('x', () => {});\n"])).toBe(false);
  });

  it('Jest: an error the runner attributes to no test is refused (round 20d)', () => {
    expect(() => readJest(jestReport('passed', {}, { 'runExecError': { message: 'x' } }), DIR, 0)).toThrow('unrecordable: jest: an error outside any test');
    // An afterAll that throws: Jest counts a file with a runtime error while its test reports its own outcome.
    expect(() => readJest(jestReport('passed', {}, { 'numRuntimeErrorTestSuites': 1, 'success': false }), DIR, 1)).toThrow('unrecordable: jest: an error outside any test');
    const failedFile = jestReport('passed', {}, { 'success': false });
    (failedFile.testResults[0] as { status: string }).status = 'failed';
    expect(() => readJest(failedFile, DIR, 1)).toThrow('unrecordable: jest: an error outside any test');
    // A file Jest could not load: failed with no test, counted as a runtime error; none of its tests ran.
    const unloaded = { testResults: [{ name: '/side/a.test.js', status: 'failed', assertionResults: [] }], 'numTotalTests': 0, 'numPassedTests': 0, 'numFailedTests': 0, 'numPendingTests': 0, 'numTodoTests': 0, 'numRuntimeErrorTestSuites': 1, 'success': false };
    expect(readJest(unloaded, DIR, 1).size).toBe(0);
  });

  it('a recorder inside the runner (node:test, pytest, unittest): its refusal is kept, a missing or malformed report is refused', () => {
    expect(readReply({ tests: { [k('a.py', 'test_x')]: 'passed' } }, 'pytest')).toEqual({ [k('a.py', 'test_x')]: 'passed' });
    expect(() => readReply({ unrecordable: 'repeated executions' }, 'pytest')).toThrow('unrecordable: repeated executions');
    expect(() => readReply(null, 'node:test')).toThrow('unrecordable: node:test: no report');
    expect(() => readReply({ version: '3.12' }, 'unittest')).toThrow('unrecordable: unittest: a malformed report');
  });
});
