#!/usr/bin/env node
// Records what the REAL test runner does with a fixture, so a fixture's
// expectation does not rest on saidvsdid's own reading of the code.
//
// For every fixtures/cases/**/case.json with "runner": "vitest" | "jest" |
// "node:test" | "playwright" | "unittest" | "pytest", base/ and head/ are copied to
// fixtures/.runner/<case>/<side>/, the runner is executed the way the fixture
// project would run it (its own vitest config, its package.json `test` script
// arguments, its jest config, its pytest configuration and conftest.py), and
// the status of each test is stored in case.json as "runnerEvidence".
// Statuses: passed | failed | skipped | todo | xfailed | xpassed (todo: a body-less todo of Vitest or Jest,
// never run; node:test runs a todo and is recorded xfailed/xpassed). A test the
// runner did not collect at all is simply absent.
//
// Keys: a test's identity, the same in every runner, structured — the JSON array [file, name, ordinal]: its file
// (relative to the fixture's side), its full name (pytest's node id after the file, `Class::test` for unittest — and
// `Class::test (x=1)` for one of its subtests, recorded as a child —, the
// describe chain `suite > test` for vitest/jest/node:test/playwright) and its ordinal among the file's tests with the
// same name (1, 2…), in the order the runner reports them. No title can collide with another's key (a title `X#2` is
// ["f", "X#2", 1], the second `X` is ["f", "X", 2]). saidvsdid names the tests of its findings the same way
// (src/rules/ids.ts); the oracle reads only theirs, and never credits a name the file repeats.
//
// The recorder fails closed (scripts/recorder-readers.mjs): a result whose form it cannot represent exactly — a retry,
// a test object run twice, a status it does not know, a test that did not finish, an outcome attached to no test, a
// missing or self-contradicting report — stops the recording of that fixture with `unrecordable: <reason>`. It never
// approximates, merges or reduces one, so the oracle is never handed evidence that does not exist. A fixture that pins
// such a form carries `"unrecordable": "<reason>"` and no evidence; the recorder must refuse it with that reason.
//
// Reconciliation with the runner's own summary: after rebuilding the results test by test, each recorder holds them
// against what the runner itself reports in aggregate — pytest's session (its terminal reporter's categories per test,
// testscollected, interruptions, tests started with no end, exitstatus), node:test's per-file `test:summary` (cancelled
// included), Jest's num*Tests and each test's `invocations`, Vitest's JSON counts and each test's retryCount/repeatCount,
// Playwright's `stats` and `results` per test, unittest's TestResult (testsRun, failures, errors, skipped,
// expectedFailures, unexpectedSuccesses, wasSuccessful) — and with the exit code, and refuses the fixture when they
// disagree, when the run shows a test run more than once, cancelled, interrupted or started with no result, or when the
// summary is missing or cannot be read. The statuses are evidence only once the runner's own account agrees with them.
//
//   node scripts/runner-evidence.mjs          # (re)write runnerEvidence
//   node scripts/runner-evidence.mjs --check  # fail if the runner disagrees
//   node scripts/runner-evidence.mjs --only vitest
//   node scripts/runner-evidence.mjs --match TG003/xfail-   # the fixtures whose id contains it
//   node scripts/runner-evidence.mjs --check --case-insensitive-only   # the `caseInsensitiveFs` fixtures alone
//                                  # (the CI's macOS job); fails unless the file system is case-insensitive
//
// test/runner-evidence.test.ts then checks each fixture's expected verdict
// against this evidence. CI runs --check with real Node and Python.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJest, readNode, readPlaywright, readReply, readVitest, Unrecordable, vitestFailsWithExtend } from './recorder-readers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASES = join(ROOT, 'fixtures', 'cases');
// SAIDVSDID_RUNNER_WORK: another working directory (a test of the script, never two runs in one).
const WORK = process.env.SAIDVSDID_RUNNER_WORK || join(ROOT, 'fixtures', '.runner');
const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const match = args.includes('--match') ? args[args.indexOf('--match') + 1] : null;
const caseInsensitiveOnly = args.includes('--case-insensitive-only');

function cases() {
  const out = [];
  for (const rule of readdirSync(CASES).sort()) {
    const ruleDir = join(CASES, rule);
    if (!statSync(ruleDir).isDirectory()) continue;
    for (const name of readdirSync(ruleDir).sort()) {
      const file = join(ruleDir, name, 'case.json');
      const meta = JSON.parse(readFileSync(file, 'utf8'));
      if (caseInsensitiveOnly && meta.caseInsensitiveFs !== true) continue;
      if (meta.runner && (!only || meta.runner === only) && (!match || `${rule}/${name}`.includes(match))) out.push({ id: `${rule}/${name}`, dir: join(ruleDir, name), file, meta });
    }
  }
  return out;
}

/** Splits a shell-ish command line into words (quotes respected, no expansion). */
function words(command) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(command))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Arguments the fixture's package.json `test` script passes to `runner`: `vitest run tests/unit` → ['tests/unit']. */
function scriptArgs(dir, runner) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return [];
  // npm strips a leading BOM before parsing.
  const scripts = JSON.parse(readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, '')).scripts ?? {};
  let script = scripts.test;
  if (!script) return [];
  // Follow `npm run <name>` delegation, as npm would.
  for (let hops = 0; hops < 5; hops++) {
    const m = /^npm run (\S+)$/.exec(script.trim());
    if (!m || !scripts[m[1]]) break;
    script = scripts[m[1]];
  }
  const w = words(script);
  const at = w.indexOf(runner);
  if (at === -1) throw new Error(`${pkgPath}: the test script does not run ${runner}: ${script}`);
  const rest = w.slice(at + 1);
  return runner === 'vitest' && rest[0] === 'run' ? rest.slice(1) : rest;
}

/**
 * Runs a runner and returns its exit code, which the readers hold against the runner's own summary. A run that ends
 * with no exit code (a signal, a runner that could not start) is not a result the recorder can read.
 */
function exitCode(runner, run) {
  try {
    run();
    return 0;
  } catch (err) {
    if (!Number.isInteger(err.status)) throw new Unrecordable(`${runner}: ended with no exit code`);
    return err.status;
  }
}

/** An empty side must still produce a report; the runners reject the flag twice. */
function withPassWithNoTests(args) {
  return args.includes('--passWithNoTests') ? args : ['--passWithNoTests', ...args];
}

// Vitest's JSON report does not say which tests are \`fails\` (an expected failure): this reporter records the mode,
// from Vitest's own reporter API (\`options.fails\`), so that an expected failure is xfailed or xpassed, never a bare
// passed or failed.
const VITEST_MODES_REPORTER = String.raw`
import { writeFileSync } from 'node:fs';
export default class {
  // Every test of every module, in the order the module declares them: [module, describe chain, fails, state, mode,
  // the task's own state, retryCount, repeatCount, what the observing runner saw] — the task's own state (Vitest's internal task, pinned version)
  // tells a test that never started (no result: null) from one that started or was queued and did not finish ('run',
  // 'queued'); retryCount and repeatCount (the reporter API's diagnostic, null for a test that did not run) say whether
  // Vitest ran it more than once.
  // Vitest's errors of the run that no test owns are written with the rows: an unhandled rejection or exception (its
  // second argument), or an error of a module or a suite that has tests (a beforeAll/afterAll that throws), while those
  // tests report their own outcome. Any one of them makes the run's results not attributable: the fixture is not
  // recorded. A module with an error and no test is one Vitest could not load: none of its tests ran.
  onTestRunEnd(modules, unhandledErrors) {
    const out = [];
    let outside = 0;
    for (const m of modules) {
      const tests = [...m.children.allTests()];
      if (tests.length > 0 && (m.errors().length > 0 || [...m.children.allSuites()].some((s) => s.errors().length > 0))) outside++;
      for (const tc of m.children.allTests()) {
        const names = [tc.name];
        for (let p = tc.parent; p && p.type === 'suite'; p = p.parent) names.unshift(p.name);
        const raw = tc.task === undefined ? 'unknown' : tc.task.result?.state ?? null;
        const d = tc.diagnostic();
        out.push([m.moduleId, names.join(' > '), tc.options.fails === true, tc.result().state, tc.options.mode, raw, d?.retryCount ?? null, d?.repeatCount ?? null, tc.meta().saidvsdid ?? null]);
      }
    }
    writeFileSync(process.env.SAIDVSDID_VITEST_MODES, JSON.stringify({ tests: out, unhandledErrors: Array.isArray(unhandledErrors) ? unhandledErrors.length : null, outside }));
  }
}
`;

// Vitest's \`fails\` inverts the outcome of the whole test and discards its errors, so its report cannot say whether the
// body failed or a hook did. This runner observes the run without changing it — Vitest's own runner, with the test's
// function called exactly as Vitest calls it (\`runTask\`) — and records in the test's meta what the body did (its own
// throw, or a failure it recorded) and how many errors the test had right after the body and at its end, before the
// inversion. scripts/recorder-readers.mjs (readVitest) reads it for an expected failure only.
const VITEST_OBSERVER = String.raw`
import { VitestTestRunner } from 'vitest/runners';
import { getFn } from '@vitest/runner';
const errorsOf = new WeakMap();
export default class extends VitestTestRunner {
  onBeforeTryTask(test, options) {
    test.meta.saidvsdid = { body: 'not-run', afterBody: null, atEnd: null };
    return super.onBeforeTryTask(test, options);
  }
  async runTask(test) {
    const fn = getFn(test);
    test.meta.saidvsdid.body = 'started';
    try {
      await fn();
    } catch (e) {
      test.meta.saidvsdid.body = 'failed';
      throw e;
    }
    test.meta.saidvsdid.body = test.result?.state === 'fail' ? 'failed' : 'passed';
  }
  onTaskFinished(test) {
    // Right after the body (and, when it did not throw, Vitest's assertion counts): the test's errors so far, and their
    // list, which every later failure is appended to. The reader takes an inverted status only from exactly one error.
    const errors = test.result?.errors;
    if (test.meta.saidvsdid) test.meta.saidvsdid.afterBody = errors?.length ?? 0;
    if (errors) errorsOf.set(test, errors);
  }
  onAfterRunTask(test) {
    const errors = errorsOf.get(test);
    if (test.meta.saidvsdid) test.meta.saidvsdid.atEnd = errors ? errors.length : test.meta.saidvsdid.afterBody;
    return super.onAfterRunTask(test);
  }
}
`;

/** The JS/TS sources of a fixture's side (never a dependency), for the recorder's static checks. */
function jsSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsSources(path));
    else if (/\.[cm]?[jt]sx?$/i.test(entry.name)) out.push(readFileSync(path, 'utf8'));
  }
  return out;
}

function runVitest(dir) {
  if (vitestFailsWithExtend(jsSources(dir))) throw new Unrecordable('vitest: fails with extended fixtures');
  const out = join(dir, '..', `${dir.split(/[\\/]/).pop()}.vitest.json`);
  const bin = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
  // The fixture's own config if it has one (vitest.config.* first, then vite.config.*, as vitest looks
  // them up); otherwise vitest's defaults (our own vitest.config.ts would be found upwards and restrict
  // `include`).
  // Looked up by the name vitest asks for (lowercase): on a case-insensitive file system a
  // `VITEST.CONFIG.TS` answers it, as it would for vitest itself.
  const files = readdirSync(dir);
  const own = files.find((f) => /^vitest\.config\.[cm]?[jt]s$/i.test(f)) ?? files.find((f) => /^vite\.config\.[cm]?[jt]s$/i.test(f));
  const name = dir.split(/[\\/]/).pop();
  // The run's config is that config (or the defaults) with the observing runner: a config that sets a runner of its own
  // is not one the recorder can observe.
  const observer = join(dir, '..', `${name}.vitest-observer.mjs`);
  writeFileSync(observer, VITEST_OBSERVER);
  const config = join(dir, '..', `${name}.vitest.config.mjs`);
  writeFileSync(config, [
    "import { mergeConfig } from 'vitest/config';",
    own ? `import own from ${JSON.stringify(`./${name}/${own.toLowerCase()}`)};` : "const own = { test: { include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'] } };",
    'export default async (env) => {',
    "  const base = (typeof own === 'function' ? await own(env) : await own) ?? {};",
    "  if (base.test?.runner !== undefined) throw new Error('saidvsdid: the config sets a runner of its own');",
    `  return mergeConfig(base, { test: { runner: ${JSON.stringify(observer)} } });`,
    '};',
    '',
  ].join('\n'));
  const modesReporter = join(dir, '..', `${name}.vitest-modes.mjs`);
  const modes = join(dir, '..', `${name}.vitest-modes.json`);
  writeFileSync(modesReporter, VITEST_MODES_REPORTER);
  rmSync(modes, { force: true });
  rmSync(out, { force: true });
  // A failing test exits non-zero; the JSON report is still written.
  const exit = exitCode('vitest', () => execFileSync(process.execPath, [bin, 'run', '--root', dir, '--config', config, '--reporter=json', `--reporter=${modesReporter}`, `--outputFile.json=${out}`, '--allowOnly', ...withPassWithNoTests(scriptArgs(dir, 'vitest'))], {
    cwd: dir,
    stdio: 'pipe',
    env: { ...process.env, CI: 'true', NO_COLOR: '1', SAIDVSDID_VITEST_MODES: modes },
  }));
  if (!existsSync(out) || !existsSync(modes)) throw new Unrecordable('vitest: no report');
  const reporter = JSON.parse(readFileSync(modes, 'utf8'));
  if (reporter === null || typeof reporter !== 'object' || !Array.isArray(reporter.tests) || !Number.isInteger(reporter.unhandledErrors)) throw new Unrecordable('vitest: no report');
  if (reporter.unhandledErrors > 0) throw new Unrecordable('vitest: unhandled errors');
  if (!Number.isInteger(reporter.outside)) throw new Unrecordable('vitest: no report');
  if (reporter.outside > 0) throw new Unrecordable('vitest: an error outside any test');
  const tests = readVitest(JSON.parse(readFileSync(out, 'utf8')), reporter.tests, dir, exit);
  const { version } = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'vitest', 'package.json'), 'utf8'));
  return { tool: `vitest ${version}`, tests };
}

function runJest(dir) {
  // Jest looks for its config upwards from the cwd; without a package.json of
  // its own the fixture would pick up ours.
  if (!existsSync(join(dir, 'package.json'))) throw new Error(`${dir}: jest fixtures need a package.json on both sides`);
  const name = dir.split(/[\\/]/).pop();
  const out = join(dir, '..', `${name}.jest.json`);
  const bin = join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
  // A fixture whose package.json says `"type": "module"` runs Jest on ES modules, as Jest documents it.
  const esm = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).type === 'module';
  rmSync(out, { force: true });
  // A failing test exits non-zero; the JSON report is still written.
  // In band: a test file that crashes its process (an unhandled rejection) ends the run with no report, which is
  // refused, instead of a worker's crash that Jest reports as a file that failed to run, its tests lost.
  const exit = exitCode('jest', () => execFileSync(process.execPath, [...(esm ? ['--experimental-vm-modules'] : []), bin, '--ci', '--runInBand', '--json', `--outputFile=${out}`, '--watchman=false', `--cacheDirectory=${join(dir, '..', `${name}.jest-cache`)}`, ...withPassWithNoTests(scriptArgs(dir, 'jest'))], {
    cwd: dir,
    stdio: 'pipe',
    env: { ...process.env, CI: 'true', NO_COLOR: '1' },
  }));
  if (!existsSync(out)) throw new Unrecordable('jest: no report');
  const tests = readJest(JSON.parse(readFileSync(out, 'utf8')), dir, exit);
  const { version } = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'jest', 'package.json'), 'utf8'));
  return { tool: `jest ${version}`, tests };
}

// A node:test reporter that records the outcome of every test (not suites) by its identity [file, describe chain,
// ordinal]: a describe chain per file (files may report interleaved), the ordinal among the file's tests with that chain;
// and Node's own summaries (`test:summary`, per file and for the run), which scripts/recorder-readers.mjs (readNode)
// reconciles the statuses with — a cancelled test is refused there.
const NODE_TEST_REPORTER = String.raw`
import { relative, sep } from 'node:path';
export default async function* reporter(source) {
  const stacks = new Map();
  const seen = new Map();
  const tests = new Map();
  const files = [];
  let run = null;
  let unrecordable = null;
  for await (const event of source) {
    const d = event.data;
    // Node's own summary, per file and for the run: what the recorder's statuses are reconciled with.
    if (event.type === 'test:summary') {
      if (d.file === undefined) run = { counts: d.counts, success: d.success };
      else files.push({ file: relative(process.cwd(), d.file).split(sep).join('/'), counts: d.counts });
      continue;
    }
    if (event.type !== 'test:start' && event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    // A test event with no file cannot be given an identity: the fixture is not recorded.
    if (d.file === undefined) { unrecordable ??= 'node:test: a test with no file'; continue; }
    const file = relative(process.cwd(), d.file).split(sep).join('/');
    if (!stacks.has(file)) stacks.set(file, []);
    const stack = stacks.get(file);
    if (event.type === 'test:start') { stack[d.nesting] = d.name; continue; }
    if (d.details?.type === 'suite') continue;
    if (event.type === 'test:fail') {
      // A failure of the test's own code comes wrapped by Node (ERR_TEST_FAILURE, with a failureType). An error that is
      // not (an aborted signal's AbortError), or a cancellation by its parent, ended the test outside its body: Node
      // counts it cancelled — or todo, for a todo test — and the recorder cannot say it ran.
      const failureType = d.details?.error?.failureType;
      if (failureType === undefined || failureType === 'cancelledByParent') { unrecordable ??= 'node:test: a cancelled test'; continue; }
      // A todo test is an expected failure only when its own body failed.
      if (d.todo !== undefined && failureType !== 'testCodeFailure') { unrecordable ??= 'node:test: a todo test that ended outside its body'; continue; }
    }
    const name = [...stack.slice(0, d.nesting), d.name].join(' > ');
    const base = JSON.stringify([file, name]);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    // A todo test runs its body and Node tolerates its failure, reporting it as todo: its explicit signal of an
    // expected failure (xfailed when the body failed, xpassed when it passed).
    tests.set(JSON.stringify([file, name, n]), d.skip !== undefined ? 'skipped' : d.todo !== undefined ? (event.type === 'test:pass' ? 'xpassed' : 'xfailed') : event.type === 'test:pass' ? 'passed' : 'failed');
  }
  yield JSON.stringify(unrecordable === null ? { tests: Object.fromEntries(tests), files, run } : { unrecordable });
}
`;

function runNodeTest(dir) {
  const name = dir.split(/[\\/]/).pop();
  const reporter = join(dir, '..', `${name}.node-reporter.mjs`);
  writeFileSync(reporter, NODE_TEST_REPORTER);
  const out = join(dir, '..', `${name}.node-test.json`);
  rmSync(out, { force: true });
  // Node's own discovery from the fixture's root (its default patterns), as `node --test` would run. A failing test
  // exits non-zero; the report is still written.
  const exit = exitCode('node:test', () => execFileSync(process.execPath, ['--test', `--test-reporter=${pathToFileURL(reporter).href}`, `--test-reporter-destination=${out}`], {
    cwd: dir,
    stdio: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  }));
  // No report is not an empty run: Node writes the reporter's output even when it finds no test.
  if (!existsSync(out)) throw new Unrecordable('node:test: no report');
  const tests = readNode(JSON.parse(readFileSync(out, 'utf8') || 'null'), exit);
  return { tool: `node:test ${process.version}`, tests };
}

// Playwright: a test's expected status (`test.fail()` expects `failed`, `test.skip()`/`test.fixme()`
// `skipped`) and Playwright's outcome of it (scripts/recorder-readers.mjs). Tests that use no browser fixture need no
// browser. One execution per test: recorded with `--retries=0`, last on the command line (over a config, the
// environment or the script's own arguments); if the runner retries a test all the same (`test.describe.configure({
// retries })`), the recorder refuses the fixture (`unrecordable: retries`) rather than read a `flaky` test as one
// outcome.
// Playwright's JSON report has no step of a hook or a fixture. This reporter counts the expected-failure tests
// (\`test.fail\`, its expected status at their end) in which a hook or a fixture step (setup or teardown) ended with an
// error: Playwright counts that failure as the expected one, whatever the body did.
const PLAYWRIGHT_STEPS_REPORTER = String.raw`
import { writeFileSync } from 'node:fs';
export default class {
  constructor() { this.failed = new Set(); this.others = 0; }
  printsToStdio() { return false; }
  onStepEnd(test, result, step) {
    if (step.error !== undefined && (step.category === 'hook' || step.category === 'fixture')) this.failed.add(result);
  }
  onTestEnd(test, result) {
    if (test.expectedStatus === 'failed' && this.failed.has(result)) this.others++;
  }
  onEnd() { writeFileSync(process.env.SAIDVSDID_PLAYWRIGHT_STEPS, JSON.stringify({ others: this.others })); }
}
`;

function runPlaywright(dir) {
  const name = dir.split(/[\\/]/).pop();
  const out = join(dir, '..', `${name}.playwright.json`);
  const stepsReporter = join(dir, '..', `${name}.playwright-steps.mjs`);
  const steps = join(dir, '..', `${name}.playwright-steps.json`);
  writeFileSync(stepsReporter, PLAYWRIGHT_STEPS_REPORTER);
  rmSync(out, { force: true });
  rmSync(steps, { force: true });
  const bin = join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
  // Playwright's defaults from the fixture's root (no config of its own: it looks for none upwards). A failing test
  // exits non-zero; the JSON report is still written.
  const exit = exitCode('playwright', () => execFileSync(process.execPath, [bin, 'test', '--workers=1', `--reporter=json,${stepsReporter}`, '--output', join(dir, '..', `${name}.playwright-results`), ...scriptArgs(dir, 'playwright').filter((a) => a !== 'test'), '--retries=0'], {
    cwd: dir,
    stdio: 'pipe',
    env: { ...process.env, CI: 'true', NO_COLOR: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: out, SAIDVSDID_PLAYWRIGHT_STEPS: steps },
  }));
  if (!existsSync(out)) throw new Unrecordable('playwright: no report');
  const report = JSON.parse(readFileSync(out, 'utf8'));
  if (report.errors?.length) throw new Unrecordable(`playwright: errors outside any test (${report.errors.map((e) => e.message).join('; ')})`);
  const tests = readPlaywright(report, dir, exit, existsSync(steps) ? JSON.parse(readFileSync(steps, 'utf8')) : null);
  const { version } = JSON.parse(readFileSync(join(ROOT, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8'));
  return { tool: `playwright ${version}`, tests };
}

// A pytest plugin that records the outcome of every collected test by node id, from pytest's structured results, never
// from a reason's text: `report.outcome`/`report.when`, `wasxfail`, whether the call raised (`call.excinfo`) and the
// xfail mark pytest evaluated for the item (`run`, `strict`). An xfail with run=False never runs its body: skipped. A
// strict xfail whose body did not raise is pytest's XPASS(strict) (a failure of the run): xpassed, its explicit signal.
// It fails closed: a node id run more than once (a rerun plugin, `--keep-duplicates`) or an outcome it does not know
// is not recorded (`unrecordable`), never merged into one status. It marks its own loading, so a pytest that stops
// before its session (exit 4) is known to have run no test, and a plugin that did not load is refused.
// Reconciliation with pytest's own session (pytest_sessionfinish): an interrupted session (`pytest.exit`, whatever its
// return code, a KeyboardInterrupt, exit 2), a session that stopped early (`-x`, `--maxfail`: shouldstop/shouldfail), a
// test whose run started (runtest_logstart) with no end (runtest_logfinish), tests collected (session.testscollected)
// with no result, a test whose categories in pytest's own summary (the terminal reporter's stats: passed, failed,
// skipped, xfailed, xpassed, error) are not its recorded status, or an exit status that disagrees with them: refused.
const PYTEST_PLUGIN = String.raw`
import json, os
import pytest
from _pytest.skipping import xfailed_key

_statuses = {}
_raised = {}
_xfail = {}
_setups = {}
_unrecordable = []
_started = set()
_finished = set()
_interrupted = []

# Loaded before pytest reads any conftest: a session that never starts (a conftest it cannot import, exit 4) leaves
# this mark, so its absence of tests is pytest's, never a plugin of ours that did not load.
with open(os.environ["SAIDVSDID_EVIDENCE_OUT"], "w") as _f:
    json.dump({"stopped": True}, _f)

def pytest_runtest_logstart(nodeid, location):
    _started.add(nodeid)

def pytest_runtest_logfinish(nodeid, location):
    _finished.add(nodeid)

def pytest_keyboard_interrupt(excinfo):
    # pytest calls it for a KeyboardInterrupt and for pytest.exit(), whatever its return code.
    _interrupted.append(True)

@pytest.hookimpl(tryfirst=True)
def pytest_runtest_makereport(item, call):
    _raised[(item.nodeid, call.when)] = call.excinfo is not None
    _xfail[item.nodeid] = item.stash.get(xfailed_key, None)

def pytest_runtest_logreport(report):
    if report.outcome not in ("passed", "failed", "skipped"):
        _unrecordable.append("pytest outcome %r" % (report.outcome,))
        return
    if report.when == "setup":
        # Every execution of a test has exactly one setup: a second one is a second execution under the same node id.
        _setups[report.nodeid] = _setups.get(report.nodeid, 0) + 1
        if _setups[report.nodeid] > 1:
            _unrecordable.append("repeated executions")
    xf = _xfail.get(report.nodeid)
    # An xfail's signal is about its body (the call): pytest also turns a failure of the setup (the body never ran) or of
    # the teardown into an xfail, and a teardown that fails after an inverted call is another failure of the same test.
    if (report.when == "setup" and hasattr(report, "wasxfail") and not (xf is not None and not xf.run)) or (
        report.when == "teardown" and (hasattr(report, "wasxfail") or (report.outcome == "failed" and _statuses.get(report.nodeid) in ("xfailed", "xpassed")))
    ):
        _unrecordable.append("pytest: an expected failure with another failure in the same test")
        return
    if report.when == "call" or (report.when == "setup" and report.outcome != "passed"):
        if hasattr(report, "wasxfail"):
            if xf is not None and not xf.run:
                status = "skipped"  # xfail(run=False): the body never ran
            else:
                status = "xfailed" if report.outcome == "skipped" else "xpassed"
        elif report.when == "call" and report.outcome == "failed" and xf is not None and xf.strict and not _raised.get((report.nodeid, "call"), True):
            status = "xpassed"  # XPASS(strict): the body passed, pytest fails the run
        elif report.outcome == "skipped":
            status = "skipped"
        elif report.outcome == "failed":
            status = "failed"
        else:
            status = "passed"
        _statuses[report.nodeid] = status
    elif report.when == "teardown" and report.outcome == "failed":
        _statuses[report.nodeid] = "failed"

# The recorded status a test may have for each of its categories in pytest's own summary.
_AGREES = {"passed": ("passed",), "skipped": ("skipped",), "xpassed": ("xpassed",), "xfailed": ("xfailed", "skipped")}
_CATEGORIES = {"passed", "failed", "skipped", "xfailed", "xpassed", "error"}

def _reconcile(session, exitstatus):
    if _unrecordable:
        return _unrecordable[0]
    if _interrupted or exitstatus == 2:
        return "pytest: the session was interrupted"
    if session.shouldstop or session.shouldfail:
        return "pytest: the session stopped early"
    if _started - _finished:
        return "pytest: a test started with no result"
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    if reporter is None:
        return "pytest: its own summary cannot be read"
    native = {}
    for category, reports in reporter.stats.items():
        if category in ("", "warnings", "deselected"):
            continue
        if category not in _CATEGORIES:
            return "pytest: its own summary has a category the recorder does not know (%s)" % (category,)
        for report in reports:
            if isinstance(report, pytest.CollectReport):
                # A skip or an error of a whole module or class at collection: an outcome of no test, which the
                # recorded statuses cannot hold.
                return "pytest: an outcome of a collection, not of a test"
            native.setdefault(getattr(report, "nodeid", None), set()).add(category)
    disagrees = "pytest: its own summary disagrees with the results"
    if set(native) != set(_statuses) or len(_statuses) != session.testscollected:
        return disagrees
    for nodeid, status in _statuses.items():
        categories = native[nodeid]
        xf = _xfail.get(nodeid)
        if categories == {"failed"} and status == "xpassed":
            if xf is None or not xf.strict:
                return disagrees  # pytest's XPASS(strict) counts as failed; nothing else may be read as xpassed
        elif "error" in categories or "failed" in categories:
            if status != "failed":
                return disagrees
        elif len(categories) != 1:
            return disagrees
        else:
            (category,) = categories
            if status not in _AGREES[category] or (category == "xfailed" and status == "skipped" and (xf is None or xf.run)):
                return disagrees
    failed = any("failed" in c or "error" in c for c in native.values())
    expected = 5 if session.testscollected == 0 else 1 if failed else 0
    if exitstatus != expected:
        return "pytest: exit %d against its own summary" % (exitstatus,)
    return None

def pytest_sessionfinish(session, exitstatus):
    reason = _reconcile(session, int(exitstatus))
    with open(os.environ["SAIDVSDID_EVIDENCE_OUT"], "w") as f:
        json.dump({"unrecordable": reason} if reason else {"tests": _statuses, "exit": int(exitstatus)}, f)
`;

function runPytest(dir) {
  const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const name = dir.split(/[\\/]/).pop();
  const pluginDir = join(dir, '..', `${name}.plugin`);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'saidvsdid_evidence.py'), PYTEST_PLUGIN);
  const out = join(dir, '..', `${name}.pytest.json`);
  rmSync(out, { force: true });
  let status = 0;
  try {
    execFileSync(python, ['-m', 'pytest', '-p', 'saidvsdid_evidence', '-p', 'no:cacheprovider', '-q', ...scriptArgs(dir, 'pytest')], {
      cwd: dir,
      stdio: 'pipe',
      env: { ...process.env, PYTHONPATH: pluginDir, SAIDVSDID_EVIDENCE_OUT: out, PYTHONDONTWRITEBYTECODE: '1' },
    });
  } catch (err) {
    // Exit 1: some test failed; exit 5: nothing collected; exit 2: a collection error interrupted the run (a generator
    // test: "'yield' keyword is allowed in fixtures, but not in tests"), the session's report says which tests ran;
    // exit 4: pytest stopped before its session (a conftest it cannot import): the plugin's mark, below.
    if (![1, 2, 4, 5].includes(err.status)) throw new Unrecordable(`pytest exit ${err.status}`);
    status = err.status;
  }
  // No report at all: the recorder's plugin never loaded, and what pytest ran is not known.
  if (!existsSync(out)) throw new Unrecordable('pytest: the recorder\'s plugin did not load');
  const reply = JSON.parse(readFileSync(out, 'utf8'));
  // The plugin loaded and pytest stopped before its session (exit 4: a usage error, a conftest it cannot import): it ran
  // no test, exactly. Stopped with any other exit is not known.
  if (reply !== null && typeof reply === 'object' && reply.stopped === true) {
    if (status !== 4) throw new Unrecordable(`pytest stopped before its session (exit ${status})`);
    const version = execFileSync(python, ['-c', 'import pytest; print(pytest.__version__)'], { encoding: 'utf8' }).trim();
    return { tool: `pytest ${version}`, tests: new Map() };
  }
  // Each node id ran once (the plugin refuses a second execution): the identity is [the file, the rest of the node id, 1].
  const ids = readReply(reply, 'pytest');
  // The process's exit code is the one pytest gave its own session, which the plugin reconciled.
  if (reply.exit !== status) throw new Unrecordable(`pytest: exit ${status} against its own summary`);
  const tests = new Map(Object.entries(ids).map(([nodeid, status]) => {
    const at = nodeid.indexOf('::');
    return [JSON.stringify(at === -1 ? [nodeid, '', 1] : [nodeid.slice(0, at), nodeid.slice(at + 2), 1]), status];
  }));
  const version = execFileSync(python, ['-c', 'import pytest; print(pytest.__version__)'], { encoding: 'utf8' }).trim();
  return { tool: `pytest ${version}`, tests };
}

// unittest, through its result API, one record per execution (a test object unittest ran), keyed [file, Class::method,
// ordinal]: a suite that runs the method more than once (`load_tests` with two instances) gives ordinals 1, 2…, a
// repeated name the oracle never credits.
// - a subtest (`self.subTest(…)`, unittest's _SubTest) belongs to its test, and is also recorded as a child of its own,
//   `Class::method <its parameters>` (unittest's description of it, e.g. `TestX::test_x (x=1)`; a repeated one by its
//   ordinal): passed, failed or skipped. A test's name has no space, so no child's identity is a test's;
// - the test is failed when anything failed or errored, its own or a subtest's: a later skip never overwrites it;
//   skipped only when the whole test was skipped with no subtest run (a test that went on running cases ran: passed,
//   its skipped subtests children); xfailed/xpassed by unittest's own expected-failure calls;
// - a class or module fixture's outcome comes on unittest's _ErrorHolder ("setUpClass (module.Class)",
//   "setUpModule (module)", "tearDownClass (…)", "tearDownModule (…)"): a setUpClass/setUpModule that raises SkipTest
//   records each test method of that class or module (enumerated by the loader before the run) as skipped, any other
//   error as failed; a tearDownClass/tearDownModule error fails the tests of that class or module that ran (the run
//   fails), a skipped one stays skipped; a SkipTest there keeps what they did.
// It fails closed (`unrecordable`, scripts/recorder-readers.mjs): one test object run twice (its two outcomes cannot be
// told apart), a placeholder of the loader's (a module it could not import: an error on no test), a fixture outcome no
// loaded test matches, a set-up outcome on a test that ran, conflicting outcomes of one test, a test that started and
// reported nothing, a test outside the fixture.
const UNITTEST_RUNNER = String.raw`
import json, os, re, sys, unittest
from unittest.case import _SubTest
from unittest.loader import _FailedTest
from unittest.suite import _ErrorHolder
from unittest.util import strclass

ROOT = sys.argv[2]

class Unrecordable(BaseException):
    pass

def refuse(reason):
    # Raised from inside unittest, the exception may be caught by its own handlers: the first reason is also kept.
    if Result.problem is None:
        Result.problem = reason
    raise Unrecordable(reason)

def where(test):
    # The file the test's class is defined in, relative to the fixture's side, or None.
    path = getattr(sys.modules.get(type(test).__module__), "__file__", None)
    if not path:
        return None
    rel = os.path.relpath(path, ROOT)
    return None if rel == os.pardir or rel.startswith(os.pardir + os.sep) else rel.replace(os.sep, "/")

def tests(suite):
    for t in suite:
        if isinstance(t, unittest.TestSuite):
            yield from tests(t)
        else:
            yield t

class Record:
    # One execution: one test object that unittest ran (or that a class or module fixture stopped).
    def __init__(self, test, rel):
        self.test = test
        self.file = rel
        self.name = type(test).__qualname__ + "::" + test._testMethodName
        self.started = False
        self.own = None          # the test's own outcome: passed, skipped, xfailed or xpassed
        self.failed = False      # a failure or error, its own or a subtest's: never overwritten
        self.subtests = []       # (description, status), in the order unittest reports them
        self.errors = 0          # failures and errors unittest reported on the test itself
        self.skips = 0           # skips unittest reported on the test itself

    def set_own(self, status):
        if self.own is not None and self.own != status:
            refuse("conflicting outcomes of one test")
        self.own = status

    def ran(self):
        return self.started and not (self.own == "skipped" and not self.subtests and not self.failed)

    def status(self):
        if self.failed:
            return "failed"
        if self.own == "skipped":
            # Skipped only when the whole test was, with no subtest run: a test that went on running cases is not.
            return "passed" if self.subtests else "skipped"
        if self.own is not None:
            return self.own
        if self.subtests:
            return "passed"      # its subtests ran (all skipped, or passed with a skip after them), nothing failed
        refuse("a test started and reported no outcome")

# A class or module fixture's outcome, on unittest's _ErrorHolder: "setUpClass (module.Class)", "setUpModule (module)",
# "tearDownClass (…)", "tearDownModule (…)" (unittest/suite.py, _createClassOrModuleLevelException).
LEVEL = re.compile(r"(setUpClass|tearDownClass|setUpModule|tearDownModule) \((.+)\)", re.S)

class Result(unittest.TextTestResult):
    records = {}             # id(test object) -> Record, in the order unittest reached them
    loaded = []
    problem = None
    holder_errors = 0        # errors and skips unittest reported on a class or module fixture (its _ErrorHolder)
    holder_skips = 0

    def _record(self, test):
        r = self.records.get(id(test))
        if r is None:
            if isinstance(test, _FailedTest):
                refuse("a module the loader could not import")
            rel = where(test)
            if rel is None or not hasattr(test, "_testMethodName"):
                refuse("a test outside the fixture")
            r = self.records[id(test)] = Record(test, rel)
        return r

    def _level(self, holder, skipped):
        m = LEVEL.fullmatch(holder.id())
        if not m:
            refuse("a class or module fixture outcome no loaded test matches")
        fixture, parent = m.groups()
        if fixture.endswith("Class"):
            hit = [t for t in self.loaded if strclass(type(t)) == parent]
        else:
            hit = [t for t in self.loaded if type(t).__module__ == parent]
        if not hit:
            refuse("a class or module fixture outcome no loaded test matches")
        for t in hit:
            if fixture.startswith("setUp"):
                # The fixture stopped the tests from running: skipped by a SkipTest, failed by anything else.
                r = self._record(t)
                if r.started:
                    refuse("a set-up outcome on a test that ran")
                if skipped:
                    r.set_own("skipped")
                else:
                    r.failed = True
            elif not skipped:
                # The class's or module's teardown failed after its tests: the tests that ran fail with the run; a
                # skipped one stays skipped. A SkipTest there keeps what every test did.
                r = self.records.get(id(t))
                if r is not None and r.ran():
                    r.failed = True

    def _subtest(self, subtest, status):
        whole, own = subtest.id(), subtest.test_case.id()
        self._record(subtest.test_case).subtests.append((whole[len(own) + 1:] if whole.startswith(own + " ") else whole, status))
        if status == "failed":
            self._record(subtest.test_case).failed = True

    def startTest(self, test):
        super().startTest(test)
        r = self._record(test)
        if r.started:
            refuse("repeated executions of one test object")
        r.started = True
    def addSuccess(self, test):
        super().addSuccess(test); self._record(test).set_own("passed")
    def addFailure(self, test, err):
        super().addFailure(test, err)
        if isinstance(test, _SubTest):
            self._subtest(test, "failed")
        else:
            r = self._record(test)
            r.failed = True
            r.errors += 1
    def addError(self, test, err):
        super().addError(test, err)
        if isinstance(test, _ErrorHolder):
            Result.holder_errors += 1
            self._level(test, False)
        elif isinstance(test, _SubTest):
            self._subtest(test, "failed")
        else:
            r = self._record(test)
            r.failed = True
            r.errors += 1
    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        if isinstance(test, _ErrorHolder):
            Result.holder_skips += 1
            self._level(test, True)
        elif isinstance(test, _SubTest):
            self._subtest(test, "skipped")
        else:
            r = self._record(test)
            r.skips += 1
            r.set_own("skipped")
    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err); self._record(test).set_own("xfailed")
    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test); self._record(test).set_own("xpassed")
    def addSubTest(self, test, subtest, outcome):
        super().addSubTest(test, subtest, outcome)
        if outcome is None:
            self._subtest(subtest, "passed")
        elif issubclass(outcome[0], unittest.SkipTest):
            self._subtest(subtest, "skipped")
        else:
            self._subtest(subtest, "failed")

suite = unittest.defaultTestLoader.discover(sys.argv[1], pattern="test*.py", top_level_dir=sys.argv[1])
Result.loaded = list(tests(suite))
def reconcile(result, records):
    # unittest's own account of the run (its TestResult's lists and counters) against the statuses rebuilt from it:
    # every event it recorded is one the recorder read, and its verdict on the run is the statuses'.
    started = [r for r in records if r.started]
    subtests = [status for r in records for _, status in r.subtests]
    statuses = [r.status() for r in records]
    rebuilt = {
        "testsRun": len(started),
        "failures+errors": sum(r.errors for r in records) + subtests.count("failed") + Result.holder_errors,
        "skipped": sum(r.skips for r in records) + subtests.count("skipped") + Result.holder_skips,
        "expectedFailures": statuses.count("xfailed"),
        "unexpectedSuccesses": statuses.count("xpassed"),
    }
    native = {
        "testsRun": result.testsRun,
        "failures+errors": len(result.failures) + len(result.errors),
        "skipped": len(result.skipped),
        "expectedFailures": len(result.expectedFailures),
        "unexpectedSuccesses": len(result.unexpectedSuccesses),
    }
    for k in native:
        if native[k] != rebuilt[k]:
            refuse("unittest: its own result disagrees with the statuses (%s: %d, rebuilt %d)" % (k, native[k], rebuilt[k]))
    if result.shouldStop:
        refuse("unittest: the run stopped early")
    if result.wasSuccessful() != ("failed" not in statuses and "xpassed" not in statuses):
        refuse("unittest: its own verdict on the run disagrees with the statuses")

reply = {}
try:
    result = unittest.TextTestRunner(resultclass=Result, stream=open(os.devnull, "w")).run(suite)
    if Result.problem is None:
        reconcile(result, list(Result.records.values()))
    if Result.problem is None:
        # Each execution keeps its own identity: a test object run twice by the suite (load_tests) is a second
        # execution of [file, Class::method], ordinal 2 — a repeated name, which the oracle never credits.
        statuses = {}
        seen = {}
        def put(file, name, status):
            seen[(file, name)] = n = seen.get((file, name), 0) + 1
            statuses[json.dumps([file, name, n], separators=(",", ":"), ensure_ascii=False)] = status
        for r in Result.records.values():
            put(r.file, r.name, r.status())
            for description, status in r.subtests:
                put(r.file, r.name + " " + description, status)
        reply = {"tests": statuses}
except Unrecordable:
    pass
if Result.problem is not None:
    reply = {"unrecordable": Result.problem}
print(json.dumps({"version": sys.version.split()[0], **reply}))
`;

function runUnittest(dir) {
  const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const raw = execFileSync(python, ['-c', UNITTEST_RUNNER, join(dir, 'tests'), dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const reply = JSON.parse(raw.trim().split('\n').pop());
  const tests = readReply(reply, 'unittest');
  return { tool: `unittest (Python ${reply.version})`, tests };
}

/**
 * A runner's statuses by test name, sorted. Test names are read from the runner's report: they are kept in a Map
 * (or parsed JSON, own keys) and written with `Object.fromEntries`, which defines each one as its own property —
 * a test named `__proto__` or `constructor` is a test like any other.
 */
function sorted(tests) {
  const entries = tests instanceof Map ? [...tests] : Object.entries(tests);
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** case.json with findings kept one per line, like the hand-written ones. */
function format(meta) {
  const line = (o) => '{ ' + Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ') + ' }';
  const lines = ['{'];
  const entries = Object.entries(meta);
  entries.forEach(([key, value], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    if (key === 'expect') {
      const { findings, ...rest } = value;
      const head = Object.entries(rest).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ');
      const body = findings.length === 0 ? '[]' : `[\n${findings.map((f) => `    ${line(f)}`).join(',\n')}\n  ]`;
      lines.push(`  "expect": { ${head}, "findings": ${body} }${comma}`);
    } else if (key === 'runnerEvidence') {
      const side = (s) => `{\n${Object.entries(s).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n    }`;
      lines.push(`  "runnerEvidence": {\n    "tool": ${JSON.stringify(value.tool)},\n    "base": ${side(value.base)},\n    "head": ${side(value.head)}\n  }${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
    }
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

// Fixtures marked `caseInsensitiveFs` (a watched config named in another case) show the runner's
// behaviour on a case-insensitive file system (Windows, macOS): elsewhere they are skipped.
mkdirSync(WORK, { recursive: true });
writeFileSync(join(WORK, 'case-probe'), '');
const caseInsensitive = existsSync(join(WORK, 'CASE-PROBE'));
rmSync(join(WORK, 'case-probe'), { force: true });
// --case-insensitive-only checks those fixtures and nothing else: it fails closed when it would check none of them.
if (caseInsensitiveOnly && !caseInsensitive) {
  console.log('--case-insensitive-only: this file system distinguishes case; the fixtures it selects cannot be checked here');
  process.exit(1);
}
if (caseInsensitiveOnly && cases().length === 0) {
  console.log('--case-insensitive-only: no fixture is marked caseInsensitiveFs');
  process.exit(1);
}

let mismatches = 0;
for (const c of cases()) {
  if (c.meta.caseInsensitiveFs && !caseInsensitive) {
    console.log(`skipped  ${c.id}  (needs a case-insensitive file system)`);
    continue;
  }
  const sides = {};
  let tool = '';
  let refused = null;
  for (const side of ['base', 'head']) {
    const dir = join(WORK, c.id, side);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    if (existsSync(join(c.dir, side))) cpSync(join(c.dir, side), dir, { recursive: true });
    const run = { vitest: runVitest, jest: runJest, 'node:test': runNodeTest, playwright: runPlaywright, unittest: runUnittest, pytest: runPytest }[c.meta.runner];
    if (!run) throw new Error(`${c.id}: unknown runner ${JSON.stringify(c.meta.runner)}`);
    try {
      const r = run(dir);
      tool = r.tool;
      sides[side] = sorted(r.tests);
    } catch (err) {
      if (!(err instanceof Unrecordable)) throw err;
      refused = `${side}: ${err.reason}`;
      // The side's reason is what the fixture pins; the other side is not recorded either.
      if (err.reason === c.meta.unrecordable) refused = err.reason;
      break;
    }
  }
  // A fixture that pins a result the recorder cannot represent (`"unrecordable": "<reason>"`) must be refused with
  // that reason, and holds no evidence; any other refusal stops the fixture's recording and fails the run.
  if (refused !== null || c.meta.unrecordable !== undefined) {
    const expected = refused !== null && refused === c.meta.unrecordable;
    console.log(`${expected ? 'refused ' : 'UNRECORDABLE'} ${c.id}  (${refused === null ? `recorded, but the fixture says unrecordable: ${c.meta.unrecordable}` : `unrecordable: ${refused}`})`);
    if (!expected) mismatches++;
    else if (!check && c.meta.runnerEvidence !== undefined) {
      const { runnerEvidence, ...meta } = c.meta;
      writeFileSync(c.file, format(meta));
    }
    continue;
  }
  // The tool version is informative; only statuses are compared in --check.
  const evidence = { tool, base: sides.base, head: sides.head };
  if (check) {
    const stored = c.meta.runnerEvidence;
    const same = stored && JSON.stringify([stored.base, stored.head]) === JSON.stringify([evidence.base, evidence.head]);
    console.log(`${same ? 'ok      ' : 'MISMATCH'} ${c.id}  (${tool})`);
    if (!same) {
      console.log(`  stored: ${JSON.stringify(stored && { base: stored.base, head: stored.head })}`);
      console.log(`  actual: ${JSON.stringify({ base: evidence.base, head: evidence.head })}`);
      mismatches++;
    }
  } else {
    writeFileSync(c.file, format({ ...c.meta, runnerEvidence: evidence }));
    console.log(`recorded ${c.id}  (${tool})  base=${JSON.stringify(evidence.base)} head=${JSON.stringify(evidence.head)}`);
  }
}
rmSync(WORK, { recursive: true, force: true });
if (mismatches > 0) process.exit(1);
