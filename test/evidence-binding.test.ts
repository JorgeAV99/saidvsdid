// --evidence is a file about some code. Evidence that records another base,
// head or tree is not about the reviewed code: TG006/TG007 are not evaluated
// (WARN). Nothing beyond that ties evidence to the code (what a run loaded is
// known only inside the runner), so nothing in it is a verification.
import { describe, expect, it } from 'vitest';
import { analyze, bindEvidence } from '../src/check.js';
import { EVIDENCE_SCHEMA_ID, type Evidence, type Run } from '../src/evidence/schema.js';

const BASE = 'b'.repeat(40);
const HEAD = 'h'.repeat(40);
const TREE = 't'.repeat(40);
const run = (over: Partial<Run> = {}): Run => ({
  id: 'r1',
  seq: 1,
  command: 'npm test',
  recognized: true,
  framework: 'vitest',
  selection: 'full',
  cwd: '',
  exit_code: 0,
  exit_unknown: null,
  source: 'wrapper',
  tree_sha: TREE,
  summary: { passed: 3, failed: 0, skipped: 0 },
  tests: [],
  output_sha256: '0'.repeat(64),
  output_truncated: false,
  ...over,
});
const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  schema: EVIDENCE_SCHEMA_ID,
  agent: { name: 'other', version: '', session_id: '' },
  repo: { base: BASE, head: HEAD },
  transcript: { format: null, complete: true, issues: [] },
  claims: [{ id: 'c1', kind: 'suite_passed', text: 'All tests pass.', source: 'last_assistant_message', certainty: 'certain', seq: 2 }],
  runs: [run()],
  edits: [],
  ...over,
});

describe('bindEvidence', () => {
  it('consistent: nothing it records contradicts the reviewed commits and tree', () => {
    expect(bindEvidence(evidence(), BASE, HEAD, TREE)).toEqual({ kind: 'consistent' });
    expect(bindEvidence(evidence({ repo: { base: null, head: null }, runs: [run({ tree_sha: null })] }), BASE, HEAD, TREE)).toEqual({ kind: 'consistent' });
    expect(bindEvidence(evidence({ runs: [] }), BASE, HEAD, TREE)).toEqual({ kind: 'consistent' });
  });

  it('mismatch: any recorded commit or tree that is not the reviewed one', () => {
    const other = 'f'.repeat(40);
    expect(bindEvidence(evidence({ repo: { base: other, head: HEAD } }), BASE, HEAD, TREE).kind).toBe('mismatch');
    expect(bindEvidence(evidence({ repo: { base: BASE, head: other } }), BASE, HEAD, TREE).kind).toBe('mismatch');
    // One run on another tree is enough, even beside a run on head's tree.
    expect(bindEvidence(evidence({ runs: [run(), run({ id: 'r2', seq: 3, tree_sha: other })] }), BASE, HEAD, TREE).kind).toBe('mismatch');
  });
});

describe('evidence in the report', () => {
  const base = "it('a', () => { expect(1).toBe(1); });\nit('b', () => { expect(2).toBe(2); });\n";
  const head = "it('a', () => { expect(1).toBe(1); });\n";
  const report = (binding: Parameters<typeof analyze>[0]['binding']) =>
    analyze({
      base: BASE,
      head: HEAD,
      changes: [{ status: 'M', basePath: 'x.test.ts', headPath: 'x.test.ts' }],
      read: (side, path) => (path === 'x.test.ts' ? (side === 'base' ? base : head) : null),
      evidence: evidence(),
      mode: 'evidence',
      ...(binding ? { binding } : {}),
    });

  it('consistent: a green recorder run on head is INFO consistent_unverified; the verdict is never a PASS', async () => {
    const r = await report({ kind: 'consistent' });
    expect(r.findings.filter((f) => f.rule === 'TG006').map((f) => [f.severity, f.reason])).toEqual([['info', 'consistent_unverified']]);
    expect(r.findings.filter((f) => f.rule === 'TG001').map((f) => f.severity)).toEqual(['warn']);
    expect(r.verdict).toBe('WARN');
  });

  it('mismatch: TG006/TG007 not evaluated, and no claim context on the diff findings', async () => {
    const r = await report({ kind: 'mismatch', reasons: ['other head'] });
    expect(r.not_evaluated.map((n) => n.rule)).toEqual(['TG006', 'TG007']);
    expect(r.findings.filter((f) => f.rule === 'TG006' || f.rule === 'TG007').map((f) => [f.severity, f.reason])).toEqual([
      ['warn', 'evidence_mismatch'],
      ['warn', 'evidence_mismatch'],
    ]);
    expect(r.findings.filter((f) => f.rule === 'TG001').map((f) => f.message.includes('the agent also claimed'))).toEqual([false]);
  });
});
