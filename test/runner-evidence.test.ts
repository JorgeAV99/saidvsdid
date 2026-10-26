// Fixture expectations checked against what the REAL runner did (recorded by
// scripts/runner-evidence.mjs, re-verified in CI with --check), independently
// of saidvsdid's own analysis and of its marker safety net.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listCases, type ExpectedFinding, type RunnerStatus } from '../fixtures/build.js';
import { identityProblems, lostTests, missingEvidence, RAN, runnerKeys } from '../fixtures/oracle.js';
import { RULE_FAIL_EFFECT, type FailEffect } from '../src/rules/effects.js';
import type { RuleId } from '../src/rules/types.js';

const withEvidence = listCases().filter((c) => c.runner && c.unrecordable === undefined);

describe('runner evidence', () => {
  it('every fixture that names a runner has recorded evidence', () => {
    expect(withEvidence.filter((c) => !c.runnerEvidence).map((c) => c.id)).toEqual([]);
    expect(withEvidence.length).toBeGreaterThanOrEqual(6);
  });

  it('a fixture the recorder refuses names its reason and holds no evidence (the recorder fails closed)', () => {
    const refused = listCases().filter((c) => c.unrecordable !== undefined);
    expect(refused.map((c) => [c.id, c.unrecordable]).sort()).toEqual([
      ['TG003/codex16-generator-pytest', 'pytest: the session was interrupted'],
      ['TG003/codex18-playwright-describe-configure-retries', 'retries'],
      ['TG003/codex18-pytest-repeated-node-id', 'repeated executions'],
      ['TG003/codex18-unittest-import-error', 'a module the loader could not import'],
      ['TG003/codex18-unittest-same-instance-twice', 'repeated executions of one test object'],
      ['TG003/codex19-jest-retry-times-failing', 'jest: a test run more than once'],
      ['TG003/codex19-node-abort-signal', 'node:test: a cancelled test'],
      ['TG003/codex19-node-abort-signal-todo', 'node:test: a cancelled test'],
      ['TG003/codex19-pytest-exit', 'pytest: the session was interrupted'],
      ['TG003/codex19-pytest-exit-returncode-0', 'pytest: the session was interrupted'],
      ['TG003/codex19-vitest-repeats', 'vitest: a test run more than once'],
      ['TG003/codex19-vitest-retry', 'vitest: a test run more than once'],
      ['TG003/codex20-jest-failing-aftereach', 'jest: an expected failure with another failure in the same test'],
      ['TG003/codex20-jest-failing-expect-assertions', 'jest: an expected failure with another failure in the same test'],
      ['TG003/codex20-node-todo-aftereach', 'node:test: a todo test that ended outside its body'],
      ['TG003/codex20-playwright-fail-aftereach', 'playwright: an expected failure with another failure in the same test'],
      ['TG003/codex20-playwright-fail-fixture-teardown', 'playwright: an expected failure with another failure in the same test'],
      ['TG003/codex20-pytest-xfail-setup-error', 'pytest: an expected failure with another failure in the same test'],
      ['TG003/codex20-pytest-xfail-strict-teardown', 'pytest: an expected failure with another failure in the same test'],
      ['TG003/codex20-pytest-xfail-teardown', 'pytest: an expected failure with another failure in the same test'],
      ['TG003/codex20-vitest-fails-aftereach', 'vitest: an expected failure with another failure in the same test'],
      ['TG003/codex20-vitest-fails-aftereach-body-fails', 'vitest: an expected failure with another failure in the same test'],
      ['TG003/codex20-vitest-fails-extend-setup', 'vitest: fails with extended fixtures'],
      ['TG003/codex20c-playwright-fail-two-soft', 'playwright: an expected failure with another failure in the same test'],
      ['TG003/codex20c-vitest-fails-soft-assertions', 'vitest: an expected failure with another failure in the same test'],
      ['TG003/codex20c-vitest-fails-two-soft', 'vitest: an expected failure with another failure in the same test'],
      ['TG003/codex20d-jest-afterall-error', 'jest: an error outside any test'],
      ['TG003/codex20d-jest-unhandled-rejection', 'jest: no report'],
      ['TG003/codex20d-vitest-afterall-error', 'vitest: an error outside any test'],
      ['TG003/codex20d-vitest-unhandled-rejection', 'vitest: unhandled errors'],
      ['TG003/py-module-skip-control', 'pytest: an outcome of a collection, not of a test'],
    ]);
    for (const c of refused) {
      expect(c.runner, c.id).toBeDefined();
      expect(c.runnerEvidence, c.id).toBeUndefined();
    }
  });

  it('reconciliation with the runner\'s own summary passes on a normal run: one control per runner, recorded (round 19)', () => {
    const controls = listCases().filter((c) => c.id.startsWith('TG003/codex19-control-'));
    expect(new Set(controls.map((c) => c.runner))).toEqual(new Set(['pytest', 'unittest', 'node:test', 'jest', 'vitest', 'playwright']));
    for (const c of controls) {
      const { base, head } = c.runnerEvidence!;
      // A passing, a failing and a skipped test at base; head skips the passing one.
      expect(Object.values(base).sort(), c.id).toEqual(['failed', 'passed', 'skipped']);
      expect(Object.values(head).sort(), c.id).toEqual(['failed', 'skipped', 'skipped']);
    }
  });

  it('an expected failure with nothing else failing keeps the runner\'s own inverted signal: one control per runner changed (round 20)', () => {
    const controls = listCases().filter((c) => c.id.startsWith('TG003/codex20-control-') && c.id !== 'TG003/codex20-control-vitest-extend');
    expect(Object.fromEntries(controls.map((c) => [c.runner, Object.values(c.runnerEvidence!.head)]))).toEqual({
      jest: ['xpassed'],
      vitest: ['xfailed'],
      playwright: ['xfailed'],
      pytest: ['xfailed'],
    });
  });

  it('a file with `test.extend` and no `fails` is recorded as usual (round 20b)', () => {
    const c = listCases().find((x) => x.id === 'TG003/codex20-control-vitest-extend')!;
    expect(Object.values(c.runnerEvidence!.base).sort()).toEqual(['failed', 'passed']);
    expect(Object.values(c.runnerEvidence!.head).sort()).toEqual(['failed', 'skipped']);
  });

  it.each(withEvidence.map((c) => [c.id, c] as const))('%s: expectation agrees with the runner', (_id, c) => {
    const { base, head } = c.runnerEvidence!;
    const lost = lostTests(base, head);
    const failures = c.expect.findings.filter((x) => x.severity === 'fail');
    const effectOf = (f: ExpectedFinding): FailEffect => {
      const effect = f.effect ?? RULE_FAIL_EFFECT[f.rule as RuleId];
      expect(effect, `${f.rule} gives no FAIL effect`).toBeDefined();
      return effect!;
    };
    // The tests a FAIL is about, as the runner keys them: the ids it lists (Finding.ids), in its file alone — for a
    // focus (TG002), the tests it leaves out; never another file's tests, never the complement of the fixture.
    const concerned = (f: ExpectedFinding): string[] => (f.ids ?? []).flatMap((id) => runnerKeys(c.runner!, f.file, id, [base, head]));
    if (c.outsideAssumption) {
      // Outside the documented assumptions (a mutation, a runner invoked with a flag that changes markers, a setup that
      // fails by itself) the code says one thing and the runner does another: the fixture pins that limit, so the
      // runner must not show the effect of any FAIL; a courtesy WARN alone leaves the tests running. Never silence.
      expect(['FAIL', 'WARN'], 'a fixture outside the assumption is never silent').toContain(c.expect.verdict);
      for (const f of failures) expect(missingEvidence(effectOf(f), base, head, concerned(f)), `outside the assumption (${c.outsideAssumption.reason}: ${c.outsideAssumption.note}) the runner does not show the effect`).not.toBeNull();
      if (failures.length === 0) expect(lost, `outside the assumption (${c.outsideAssumption.reason}: ${c.outsideAssumption.note}) the runner still runs the tests`).toEqual([]);
      return;
    }
    if (lost.length > 0) expect(['PASS', 'OK'], `runner stopped running ${lost.join(', ')}`).not.toContain(c.expect.verdict);
    // A negative control of the oracle: what the runner shows here must not count as evidence of that effect.
    if (c.oracleControl) expect(missingEvidence(c.oracleControl, base, head), `${c.id} must not be evidence of ${c.oracleControl}`).not.toBeNull();
    // Each FAIL's effect (src/rules/effects.ts) asks for its own evidence, in the status of the tests it names alone:
    // tests no longer run, or a new expected failure the runner reports as one.
    // Every identity the FAIL names, each on its own (fixtures/oracle.ts, identityProblems): a correct loss never hides
    // a false one.
    for (const f of failures) {
      const at = `${f.rule} ${f.file}:${f.line ?? ''}`;
      expect(identityProblems(effectOf(f), c.runner!, f.file, f.ids ?? [], base, head), at).toEqual([]);
      expect(missingEvidence(effectOf(f), base, head, concerned(f)), at).toBeNull();
    }
    // A fixture that says the change moves the selection: the runner ran a different set of tests.
    if (c.selectionChanges) {
      const ran = (side: Record<string, RunnerStatus>): string[] => Object.keys(side).filter((t) => RAN.has(side[t]!)).sort();
      expect(ran(head), 'the real runner must run a different set of tests at head').not.toEqual(ran(base));
    }
  });
});

// The CI's macOS job checks the `caseInsensitiveFs` fixtures alone (.github/workflows/full-ci.yml): on a file system
// that distinguishes case the option fails, never a green run that checked nothing.
const work = mkdtempSync(join(tmpdir(), 'saidvsdid-runner-work-'));
writeFileSync(join(work, 'case-probe'), '');
const caseSensitive = !existsSync(join(work, 'CASE-PROBE'));
rmSync(work, { recursive: true, force: true });

describe('--case-insensitive-only', () => {
  it('selects fixtures that exist', () => {
    expect(listCases().filter((c) => c.caseInsensitiveFs === true && c.runner).length).toBeGreaterThan(0);
  });

  it.runIf(caseSensitive)('fails on a case-sensitive file system', () => {
    const dir = mkdtempSync(join(tmpdir(), 'saidvsdid-runner-work-'));
    try {
      const r = spawnSync(process.execPath, ['scripts/runner-evidence.mjs', '--check', '--case-insensitive-only'], { encoding: 'utf8', env: { ...process.env, SAIDVSDID_RUNNER_WORK: dir } });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('this file system distinguishes case');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
