// The readers of scripts/runner-evidence.mjs: what each runner's report says, turned into statuses by identity.
//
// The recorder fails closed. A result whose form it cannot represent exactly — a test run more than once under one
// identity it cannot tell apart, a retry, a status it does not know, a test that did not finish, an outcome attached
// to no test, a report that is missing or disagrees with itself — stops the recording of that fixture with an explicit
// error, `unrecordable: <reason>`. It never approximates, merges or reduces one: the oracle (fixtures/oracle.ts) is
// never handed evidence that does not exist. A fixture that pins such a form says so in its case.json
// (`"unrecordable": "<reason>"`), and the recorder must refuse it with that reason.
//
// Reconciliation with the runner's own summary. After the results are rebuilt test by test, each reader holds them
// against what the runner itself reports in aggregate, and refuses the fixture when:
// - the counts per status it rebuilt differ from the runner's own (passed, failed, skipped, todo, xfailed/xpassed,
//   cancelled… as that runner counts them);
// - the exit code does not agree with them;
// - the summary or the results show a test run more than once or abnormally: a retry or a repeat (Jest's
//   `invocations` > 1, Vitest's `retryCount`/`repeatCount` > 0, more than one Playwright `results`), a cancellation
//   (node:test's `cancelled`), an interrupted session (pytest: `pytest.exit`, `KeyboardInterrupt`, a session that stopped
//   early, exit 2), a test that started with no result;
// - the run holds an error the runner attributes to no test (an unhandled rejection, a beforeAll/afterAll that throws
//   in a file with tests, an error of the run);
// - the summary does not exist or cannot be read.
// The rebuilt statuses are evidence only once the runner's own account of the same run agrees with them.
//
// No inverted status (xfailed, xpassed) is deduced from a generic failed or passed. An expected-failure test (Jest's
// `failing`, Vitest's `fails`, Playwright's `test.fail`, pytest's `xfail`) is recorded xfailed or xpassed only from the
// runner's own signal for that exact case — its body failed, or its body passed — and only when the test has exactly
// the one error that signal is (none other: a second assertion, a soft assertion, an assertion count, a hook, a
// fixture's setup or teardown). Without that signal, or with two or more errors, the fixture is not recorded:
// `<runner>: an expected failure with another failure in the same test`.
import { isAbsolute, relative, sep } from 'node:path';

/** A result the recorder cannot represent exactly: the fixture is not recorded. */
export class Unrecordable extends Error {
  constructor(reason) {
    super(`unrecordable: ${reason}`);
    this.reason = reason;
  }
}

/** The identity of a test: the JSON array [file, name, ordinal]; `seen` counts them per run. */
export function identity(seen, dir, file, name) {
  const rel = (isAbsolute(file) ? relative(dir, file) : file).split(sep).join('/');
  const base = JSON.stringify([rel, name]);
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return JSON.stringify([rel, name, n]);
}

/** A table of exact readings: a key it does not hold is a status the recorder does not know. */
function exact(table, value, what) {
  if (typeof value !== 'string' || !Object.hasOwn(table, value)) throw new Unrecordable(`${what} ${JSON.stringify(value)}`);
  return table[value];
}

/** A count of the runner's own summary: a non-negative integer, or the summary cannot be read. */
function count(summary, key, runner) {
  const v = summary === null || typeof summary !== 'object' ? undefined : summary[key];
  if (!Number.isInteger(v) || v < 0) throw new Unrecordable(`${runner}: its own summary cannot be read (${key})`);
  return v;
}

/** The rebuilt counts must be the runner's own, exactly. */
function reconcile(runner, rebuilt, native) {
  for (const key of Object.keys(native)) {
    if (rebuilt[key] !== native[key]) throw new Unrecordable(`${runner}: its own summary disagrees with the results (${key}: ${native[key]}, rebuilt ${rebuilt[key]})`);
  }
}

/** The exit code must be the one the runner gives for this outcome: 0 when it succeeded, 1 when it did not. */
function exitAgrees(runner, exit, succeeded) {
  if (exit !== (succeeded ? 0 : 1)) throw new Unrecordable(`${runner}: exit ${exit} against its own summary`);
}

// Vitest's JSON status, read against the reporter API's own state of the same test (the modes reporter of
// runner-evidence.mjs: [module, describe chain, fails, state, mode, raw state, retryCount, repeatCount]). Vitest says
// `pending` both for a test it never started (no result: a `test.only` inside a `describe.skip`) and for one that started
// or was queued and did not finish: the first did not run (skipped), the second is refused. Its JSON maps an unknown
// state to `skipped`, so a `skipped` is accepted only when the reporter API says `skipped` too. A test Vitest ran more
// than once (`retry`, `repeats`: the reporter API's `retryCount`/`repeatCount`) is refused. Then the JSON's own counts
// (numTotalTests, numPassedTests, numFailedTests, numPendingTests, numTodoTests) and `success` must agree with the
// statuses, and the exit code with `success`.
const VITEST_STATUS = { passed: 'passed', failed: 'failed', skipped: 'skipped', todo: 'todo' };
const VITEST_STATE = { passed: 'passed', failed: 'failed', skipped: 'skipped', todo: 'skipped' };

export function readVitest(report, modes, dir, exit) {
  const api = new Map();
  const apiSeen = new Map();
  for (const [file, chain, fails, state, mode, raw, retryCount, repeatCount, observed] of modes) {
    if ((retryCount ?? 0) !== 0 || (repeatCount ?? 0) !== 0) throw new Unrecordable('vitest: a test run more than once');
    api.set(identity(apiSeen, dir, file, chain), { fails, state, mode, raw, observed });
  }
  const tests = new Map();
  const raw = { total: 0, passed: 0, failed: 0, pending: 0, todo: 0 };
  const seen = new Map();
  for (const file of report.testResults) {
    for (const t of file.assertionResults) {
      const key = identity(seen, dir, file.name, [...t.ancestorTitles, t.title].join(' > '));
      const own = api.get(key);
      if (!own) throw new Unrecordable('vitest: its JSON report and its reporter API disagree on the tests');
      raw.total++;
      if (t.status === 'pending') {
        if (own.state !== 'pending' || own.raw !== null) throw new Unrecordable('vitest: a test that did not finish (pending)');
        tests.set(key, 'skipped'); // never started: it did not run (Vitest counts it in no status but the total)
        continue;
      }
      const status = exact(VITEST_STATUS, t.status, 'vitest status');
      if (own.state !== VITEST_STATE[status] || (status === 'todo') !== (own.mode === 'todo')) throw new Unrecordable(`vitest: status ${status} against the reporter API's ${own.state}`);
      raw[status === 'skipped' ? 'pending' : status]++;
      // An expected failure (`fails`): Vitest reports its body failing as passed, and its body passing as failed.
      tests.set(key, own.fails && (status === 'passed' || status === 'failed') ? vitestInverted(status, own.observed) : status);
    }
  }
  if (tests.size !== api.size) throw new Unrecordable('vitest: its JSON report and its reporter API disagree on the tests');
  reconcile('vitest', raw, {
    total: count(report, 'numTotalTests', 'vitest'),
    passed: count(report, 'numPassedTests', 'vitest'),
    failed: count(report, 'numFailedTests', 'vitest'),
    pending: count(report, 'numPendingTests', 'vitest'),
    todo: count(report, 'numTodoTests', 'vitest'),
  });
  if (typeof report.success !== 'boolean') throw new Unrecordable('vitest: its own summary cannot be read (success)');
  if (raw.failed > 0 && report.success) throw new Unrecordable('vitest: a failed test in a run it calls successful');
  exitAgrees('vitest', exit, report.success);
  return tests;
}

// Vitest's `fails` inverts the outcome of the whole test — body, hooks, fixtures, assertion counts — and discards its
// errors. What the test's own body did comes from the observing runner of runner-evidence.mjs (VITEST_OBSERVER: the
// body's own outcome, the test's errors right after it and at its end, before the inversion): passed is xfailed only
// when the body failed and the test had exactly one error, the body's (`expect.soft` and `expect.assertions` add
// errors of their own); failed is xpassed only when the body passed and the test had no error (the inversion of a test
// where nothing failed, whose one error is Vitest's own). Anything else is another failure in the same test.
function vitestInverted(status, observed) {
  const o = observed !== null && typeof observed === 'object' ? observed : {};
  const exact = status === 'passed'
    ? o.body === 'failed' && o.afterBody === 1 && o.atEnd === 1
    : o.body === 'passed' && o.afterBody === 0 && o.atEnd === 0;
  if (!exact) throw new Unrecordable('vitest: an expected failure with another failure in the same test');
  return status === 'passed' ? 'xfailed' : 'xpassed';
}

// Vitest sets up the fixtures of an extended test API (`test.extend`, `it.extend`, or any alias of them: `base.extend`)
// inside the test's function and, under `fails`, inverts their setup's failure with the body's: a body that never ran
// reads as an expected failure, and no signal tells them apart. A static check of the fixture's own sources (ours),
// failing closed: when any of them reads a member `.extend` and any holds `fails` (a modifier or an option), in code,
// a comment or a string alike, the fixture is not recorded. The sources of a side, not one file: a helper may export the
// extended test that another file marks `fails`.
export function vitestFailsWithExtend(sources) {
  return sources.some((s) => /\.\s*extend\b/.test(s)) && sources.some((s) => /\bfails\b/.test(s));
}

// Jest's statuses: `pending` and `disabled` are tests Jest did not run (skipped). `focused`, or any other, is not a
// result the recorder knows. A test Jest ran more than once (`jest.retryTimes`: `invocations` > 1) is refused. Then
// its own counts (numTotalTests, numPassedTests, numFailedTests, numPendingTests, numTodoTests) and `success` must agree
// with the statuses, and the exit code with `success`.
const JEST_STATUS = { passed: 'passed', failed: 'failed', skipped: 'skipped', pending: 'skipped', todo: 'todo', disabled: 'skipped' };

// Jest's `failing`: its body's failure is swallowed, and any other error (a hook, an assertion count) still fails the
// test, so `passed` is the body failing and nothing else (xfailed). `failed` is xpassed only with Jest's own signal of
// a passing body — one failure, whose message is exactly the one Jest gives it — never any other failure.
const JEST_FAILING_PASSED = 'Failing test passed even though it was supposed to fail. Remove `.failing` to remove error.';

function jestInverted(status, t) {
  // Jest swallows the body's one error and keeps any other, which fails the test: passed holds none.
  if (status === 'passed' && Array.isArray(t.failureMessages) && t.failureMessages.length === 0) return 'xfailed';
  const details = t.failureDetails;
  if (Array.isArray(t.failureMessages) && t.failureMessages.length === 1 && Array.isArray(details) && details.length === 1
    && details[0] !== null && typeof details[0] === 'object' && details[0].message === JEST_FAILING_PASSED) return 'xpassed';
  throw new Unrecordable('jest: an expected failure with another failure in the same test');
}

// An error Jest attributes to no test refuses the fixture: the run's (`runExecError`), or a file's (`testExecError`, or a
// file that failed while none of its tests did) in a file whose tests report their own outcome — and Jest's own count of
// files with such an error (`numRuntimeErrorTestSuites`: a beforeAll/afterAll that throws) above the files that failed
// with no test. A file that failed with no test is one Jest could not load: none of its tests ran.
export function readJest(report, dir, exit) {
  if (report.runExecError !== undefined && report.runExecError !== null) throw new Unrecordable('jest: an error outside any test');
  const unloaded = report.testResults.filter((f) => f.status === 'failed' && (!Array.isArray(f.assertionResults) || f.assertionResults.length === 0)).length;
  if (count(report, 'numRuntimeErrorTestSuites', 'jest') > unloaded) throw new Unrecordable('jest: an error outside any test');
  const tests = new Map();
  const raw = { total: 0, passed: 0, failed: 0, pending: 0, todo: 0 };
  const seen = new Map();
  for (const file of report.testResults) {
    const results = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    const fileError = (file.testExecError !== undefined && file.testExecError !== null) || (file.status === 'failed' && !results.some((t) => t.status === 'failed'));
    if (results.length > 0 && fileError) throw new Unrecordable('jest: an error outside any test');
    for (const t of file.assertionResults) {
      const status = exact(JEST_STATUS, t.status, 'jest status');
      if (!Number.isInteger(t.invocations) || t.invocations < 0) throw new Unrecordable('jest: its own summary cannot be read (invocations)');
      if (t.invocations > 1) throw new Unrecordable('jest: a test run more than once');
      raw.total++;
      raw[status === 'skipped' ? 'pending' : status]++;
      // `failing` (an expected failure), as Jest's report says it: its body failing is passed, passing is failed.
      tests.set(identity(seen, dir, file.name, [...t.ancestorTitles, t.title].join(' > ')), t.failing === true && (status === 'passed' || status === 'failed') ? jestInverted(status, t) : status);
    }
  }
  reconcile('jest', raw, {
    total: count(report, 'numTotalTests', 'jest'),
    passed: count(report, 'numPassedTests', 'jest'),
    failed: count(report, 'numFailedTests', 'jest'),
    pending: count(report, 'numPendingTests', 'jest'),
    todo: count(report, 'numTodoTests', 'jest'),
  });
  if (typeof report.success !== 'boolean') throw new Unrecordable('jest: its own summary cannot be read (success)');
  if (raw.failed > 0 && report.success) throw new Unrecordable('jest: a failed test in a run it calls successful');
  exitAgrees('jest', exit, report.success);
  return tests;
}

// Playwright's outcome of each test (`t.status`) and its expected status. A test run more than once (a retry, from
// `--retries`, a configuration or `test.describe.configure`) is not recorded: one execution per test, or none. Then its
// own `stats` (expected, unexpected, flaky, skipped) must count the same outcomes, and the exit code agree with them.
const PLAYWRIGHT_OUTCOMES = new Set(['expected', 'unexpected', 'skipped']);
const PLAYWRIGHT_EXPECTED = new Set(['passed', 'failed', 'skipped']);

// `steps` is the step reporter's account of the same run (PLAYWRIGHT_STEPS_REPORTER of runner-evidence.mjs): the number
// of expected-failure tests (`test.fail`) in which a hook or a fixture also failed. Playwright counts such a failure as
// the expected one (outcome `expected`), whatever the body did: the fixture is not recorded.
export function readPlaywright(report, dir, exit, steps) {
  if (steps === null || typeof steps !== 'object' || !Number.isInteger(steps.others) || steps.others < 0) throw new Unrecordable('playwright: no step report');
  if (steps.others > 0) throw new Unrecordable('playwright: an expected failure with another failure in the same test');
  const tests = new Map();
  const outcomes = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  const seen = new Map();
  const walk = (file, suite, chain) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) {
        if (t.results.length > 1) throw new Unrecordable('retries');
        if (!PLAYWRIGHT_OUTCOMES.has(t.status)) throw new Unrecordable(`playwright outcome ${JSON.stringify(t.status)}`);
        if (!PLAYWRIGHT_EXPECTED.has(t.expectedStatus)) throw new Unrecordable(`playwright expected status ${JSON.stringify(t.expectedStatus)}`);
        if (t.results.length === 0 && t.status !== 'skipped') throw new Unrecordable('playwright: an outcome with no run');
        outcomes[t.status]++;
        // An expected failure is xfailed only when its outcome is `expected` (its body failed as `test.fail` expects)
        // with exactly one error in its result (`expect.soft` adds one per failure); a body that passed, with no
        // error, is xpassed; a timeout, an interruption or any other unexpected end is a failure.
        const run = t.results[0]?.status;
        const errors = t.results[0]?.errors;
        const status = t.status === 'skipped' || t.expectedStatus === 'skipped'
          ? 'skipped'
          : t.expectedStatus === 'failed'
            ? t.status === 'expected' ? 'xfailed' : run === 'passed' ? 'xpassed' : 'failed'
            : t.status === 'expected' ? 'passed' : 'failed';
        if ((status === 'xfailed' || status === 'xpassed') && (!Array.isArray(errors) || errors.length !== (status === 'xfailed' ? 1 : 0))) {
          throw new Unrecordable('playwright: an expected failure with another failure in the same test');
        }
        tests.set(identity(seen, dir, file, [...chain, spec.title].join(' > ')), status);
      }
    }
    for (const child of suite.suites ?? []) walk(file, child, [...chain, child.title]);
  };
  // The top-level suites are the files (their title is the path from the root): the chain starts below them.
  for (const file of report.suites ?? []) walk(file.title, file, []);
  const stats = report.stats;
  reconcile('playwright', outcomes, {
    expected: count(stats, 'expected', 'playwright'),
    unexpected: count(stats, 'unexpected', 'playwright'),
    flaky: count(stats, 'flaky', 'playwright'),
    skipped: count(stats, 'skipped', 'playwright'),
  });
  exitAgrees('playwright', exit, outcomes.unexpected === 0);
  return tests;
}

// node:test, from the reporter of runner-evidence.mjs: each test's status, and each file's own summary (`test:summary`:
// tests, passed, failed, cancelled, skipped, todo) and the run's. A cancelled test (an aborted signal, a parent that
// ended first) is refused; then each file's counts must be the statuses rebuilt for it (a todo test, run and tolerated,
// is xfailed or xpassed), and the exit code agree with the run's own `success`.
export function readNode(reply, exit) {
  const tests = readReply(reply, 'node:test');
  if (!Array.isArray(reply.files) || reply.run === null || typeof reply.run !== 'object' || typeof reply.run.success !== 'boolean') {
    throw new Unrecordable('node:test: its own summary cannot be read');
  }
  const rebuilt = new Map();
  for (const [key, status] of Object.entries(tests)) {
    const file = JSON.parse(key)[0];
    if (!rebuilt.has(file)) rebuilt.set(file, { tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0 });
    const r = rebuilt.get(file);
    r.tests++;
    r[status === 'xfailed' || status === 'xpassed' ? 'todo' : status]++;
  }
  const summarised = new Set();
  for (const { file, counts } of reply.files) {
    if (count(counts, 'cancelled', 'node:test') > 0) throw new Unrecordable('node:test: a cancelled test');
    reconcile('node:test', rebuilt.get(file) ?? { tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0 }, {
      tests: count(counts, 'tests', 'node:test'),
      passed: count(counts, 'passed', 'node:test'),
      failed: count(counts, 'failed', 'node:test'),
      skipped: count(counts, 'skipped', 'node:test'),
      todo: count(counts, 'todo', 'node:test'),
    });
    summarised.add(file);
  }
  for (const file of rebuilt.keys()) if (!summarised.has(file)) throw new Unrecordable('node:test: a file with no summary of its own');
  if (count(reply.run.counts, 'cancelled', 'node:test') > 0) throw new Unrecordable('node:test: a cancelled test');
  const failed = [...rebuilt.values()].some((r) => r.failed > 0);
  if (failed && reply.run.success) throw new Unrecordable('node:test: a failed test in a run it calls successful');
  exitAgrees('node:test', exit, reply.run.success);
  return tests;
}

/** The reply of a recorder that runs inside the runner (node:test, pytest, unittest): `{ tests }` or `{ unrecordable }`. */
export function readReply(reply, runner) {
  if (reply === null || typeof reply !== 'object') throw new Unrecordable(`${runner}: no report`);
  if (Object.hasOwn(reply, 'unrecordable')) throw new Unrecordable(String(reply.unrecordable));
  if (!Object.hasOwn(reply, 'tests') || reply.tests === null || typeof reply.tests !== 'object') throw new Unrecordable(`${runner}: a malformed report`);
  return reply.tests;
}
