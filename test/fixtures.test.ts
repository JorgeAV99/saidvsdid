import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildFixtureRepo, caseCwd, caseEvidence, linkNodeModules, listCases, transcriptPath, unlinkNodeModules, type ExpectedFinding } from '../fixtures/build.js';
import { runCheck } from '../src/check.js';
import { holdsPython, olderPythonRefused, pythonAtLeast } from './support/python.js';
import { parseEvidence } from '../src/evidence/schema.js';
import { RULES } from '../src/rules/index.js';
import { RULE_FAIL_EFFECT } from '../src/rules/effects.js';
import type { RuleId } from '../src/rules/types.js';

// SAIDVSDID_FIXTURES=python: only the fixtures with a Python file (the CI's Python-version matrix).
// SAIDVSDID_FIXTURES=f2p: only the fixtures checked with --f2p, which run the repository's own runner (src/f2p.ts names
// the interpreter and joins PYTHONPATH by platform: full-ci.yml's Windows job). Any other value is an error.
const only = process.env['SAIDVSDID_FIXTURES'];
if (only !== undefined && only !== 'python' && only !== 'f2p') throw new Error(`SAIDVSDID_FIXTURES=${only}: python or f2p`);
const cases = listCases().filter((c) => (only === 'python' ? holdsPython(c.dir) : only === 'f2p' ? c.f2p === true : true));
const workdir = mkdtempSync(join(tmpdir(), 'saidvsdid-fixtures-'));
const linked: string[] = [];
afterAll(() => {
  // Links first, never followed: they point at this project's node_modules.
  for (const repo of linked) unlinkNodeModules(repo);
  rmSync(workdir, { recursive: true, force: true });
  // One git repository per case: removing them all is slow on Windows runners.
}, 120_000);

/** The rules whose FAIL is about the status of tests (Finding.ids). */
const TESTS_RULES = new Set(['TG001', 'TG002', 'TG003']);

function key(f: ExpectedFinding): string {
  // A FAIL's effect is always compared: given in the expectation when it is not its rule's (src/rules/effects.ts).
  const effect = f.severity === 'fail' ? (f.effect ?? RULE_FAIL_EFFECT[f.rule as RuleId] ?? null) : null;
  // A FAIL of TG001–TG003 lists the ids of the tests it is about: the runner-evidence oracle reads their status alone.
  const ids = f.severity === 'fail' && TESTS_RULES.has(f.rule) ? (f.ids ?? []) : null;
  return JSON.stringify([f.rule, f.severity, f.file, f.line ?? null, f.test ?? null, f.reason ?? null, effect, ids]);
}

// The matrix is about every fixture: not under a filter.
describe.skipIf(only !== undefined)('fixture matrix', () => {
  for (const rule of RULES) {
    it(`${rule.id} has positive, negative and hard-legit fixtures`, () => {
      const kinds = new Set(cases.filter((c) => c.id.startsWith(`${rule.id}/`)).map((c) => c.kind));
      expect([...kinds].sort()).toEqual(['hard-legit', 'negative', 'positive']);
    });
  }
});

describe.each(cases)('$id ($kind)', (c) => {
  it(c.description, async () => {
    if (c.minPython && !pythonAtLeast(c.minPython)) {
      // An older interpreter rejects the file (a WARN of its own): the expectation is for Python ≥ minPython.
      expect(olderPythonRefused(c.minPython), c.id).toBeNull();
      return;
    }
    const built = buildFixtureRepo(c.dir, join(workdir, c.id), c.session, c.links);
    const { repo, base, head } = built;
    const evidenceText = caseEvidence(c, built);
    const evidence = evidenceText === null ? null : parseEvidence(evidenceText);
    if (evidence && !evidence.ok) throw new Error(`${c.id}: invalid evidence: ${evidence.errors.join('; ')}`);
    if (c.f2p) {
      // --f2p runs the repository's own runner: give the fixture repository ours.
      linkNodeModules(repo);
      linked.push(repo);
    }
    const transcript = transcriptPath(c);
    const report = await runCheck({
      repo,
      base,
      head,
      exclude: c.exclude ?? [],
      transcript: transcript ? { text: readFileSync(transcript, 'utf8'), agent: c.agent ?? 'auto', label: basename(transcript) } : null,
      ...(evidence?.ok ? { evidence: evidence.value, evidenceLabel: basename(c.evidence!) } : {}),
      f2p: c.f2p ? { timeoutMs: 120_000 } : null,
      cwd: caseCwd(c),
    });
    // A reason is compared only for the rule and severity whose expected findings give one.
    const withReason = new Set(c.expect.findings.filter((f) => f.reason !== undefined).map((f) => `${f.rule}|${f.severity}`));
    const actual = report.findings.map((f) =>
      key({ rule: f.rule, severity: f.severity, file: f.file, line: f.line, test: f.test, ...(f.effect !== undefined ? { effect: f.effect } : {}), ...(f.ids !== undefined ? { ids: f.ids } : {}), ...(withReason.has(`${f.rule}|${f.severity}`) && f.reason !== undefined ? { reason: f.reason } : {}) }),
    );
    expect(actual.sort()).toEqual(c.expect.findings.map(key).sort());
    expect(report.unverifiable.map((u) => ({ file: u.file, side: u.side }))).toEqual(c.expect.unverifiable ?? []);
    expect(report.not_evaluated.map((n) => n.rule)).toEqual(c.expect.notEvaluated ?? (transcript || evidence ? [] : ['TG006', 'TG007']));
    expect(report.verdict).toBe(c.expect.verdict);
    // Claims are warnings for the reviewer: never a FAIL, never "verified" or "backed by", never a PASS.
    const claimFindings = report.findings.filter((f) => f.rule === 'TG006' || f.rule === 'TG007');
    expect(claimFindings.filter((f) => f.severity === 'fail' || /\bverified\b|\bbacked by\b/i.test(f.message.replace(/not verified|unverified/gi, ''))).map((f) => f.message)).toEqual([]);
    expect(report.verdict).not.toBe('PASS');
  });
});

describe('fixture repos are reproducible', () => {
  it('builds identical SHAs for the same case', () => {
    const c = cases[0]!;
    const a = buildFixtureRepo(c.dir, join(workdir, 'repro-a'));
    const b = buildFixtureRepo(c.dir, join(workdir, 'repro-b'));
    expect([a.base, a.head]).toEqual([b.base, b.head]);
  });
});
