import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEvidence, validateEvidence } from '../src/evidence/schema.js';

const doc = readFileSync(new URL('../docs/evidence.md', import.meta.url), 'utf8');
const example = JSON.parse(/## Example\s+```json\n([\s\S]*?)```/.exec(doc)![1]!) as Record<string, unknown>;

type Json = Record<string, unknown>;
const clone = (): Json => structuredClone(example);
const runs = (e: Json): Json[] => e['runs'] as Json[];
const edits = (e: Json): Json[] => e['edits'] as Json[];

function errorsOf(value: unknown): string[] {
  const r = validateEvidence(value);
  return r.ok ? [] : r.errors;
}

describe('evidence/v2 schema', () => {
  it('accepts the example in docs/evidence.md', () => {
    expect(errorsOf(example)).toEqual([]);
  });

  it('accepts null exit_code, summary, tree_sha, cwd, repo commits, transcript format and edit path', () => {
    const e = clone();
    Object.assign(runs(e)[0]!, { exit_code: null, summary: null, tree_sha: null, cwd: null });
    Object.assign(e['repo'] as Json, { base: null, head: null });
    (e['transcript'] as Json)['format'] = null;
    edits(e)[0]!['path'] = null;
    expect(errorsOf(e)).toEqual([]);
  });

  it('rejects unknown fields with their path', () => {
    const e = clone();
    runs(e)[0]!['duration_ms'] = 12;
    edits(e)[0]!['at'] = '2026-03-01T10:17:55Z';
    e['extra'] = true;
    expect(errorsOf(e)).toEqual([
      expect.stringMatching(/^\$\.runs\[0\]\.duration_ms: unknown field \(evidence\/v2 allows/),
      expect.stringMatching(/^\$\.edits\[0\]\.at: unknown field/),
      expect.stringMatching(/^\$\.extra: unknown field/),
    ]);
  });

  it('rejects wrong types', () => {
    const e = clone();
    runs(e)[0]!['exit_code'] = '0';
    runs(e)[0]!['output_truncated'] = 'no';
    runs(e)[0]!['seq'] = -1;
    (e['transcript'] as Json)['issues'] = [1];
    expect(errorsOf(e)).toEqual([
      '$.transcript.issues[0]: expected string, got number',
      '$.runs[0].seq: expected non-negative integer, got -1',
      '$.runs[0].exit_code: expected integer, got "0"',
      '$.runs[0].output_truncated: expected boolean, got string',
    ]);
  });

  it('rejects unknown enum values', () => {
    const e = clone();
    (e['agent'] as Json)['name'] = 'cursor';
    runs(e)[0]!['framework'] = 'mocha';
    runs(e)[0]!['selection'] = 'partial';
    edits(e)[0]!['certainty'] = 'likely';
    const errors = errorsOf(e);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/^\$\.agent\.name: expected one of "claude-code" \| "codex" \| "other", got "cursor"$/);
    expect(errors[1]).toMatch(/^\$\.runs\[0\]\.framework: expected one of .*got "mocha"$/);
    expect(errors[2]).toMatch(/^\$\.runs\[0\]\.selection: expected one of "full" \| "filtered" \| "unknown", got "partial"$/);
    expect(errors[3]).toMatch(/^\$\.edits\[0\]\.certainty: expected one of "certain" \| "uncertain", got "likely"$/);
  });

  it('rejects missing fields, bad SHAs and duplicate ids', () => {
    const e = clone();
    delete (e['repo'] as Json)['head'];
    (e['repo'] as Json)['base'] = 'abc123';
    runs(e).push({ ...runs(e)[0]! });
    delete (e as Json)['transcript'];
    expect(errorsOf(e)).toEqual([
      expect.stringMatching(/^\$\.repo\.base: expected full lowercase git object id/),
      '$.repo.head: missing required field',
      '$.transcript: missing required field',
      '$.runs[1].id: duplicate run id "r1"',
    ]);
  });

  it('rejects evidence/v1 with a pointer to v2, other schema ids and invalid JSON', () => {
    expect(errorsOf({ ...clone(), schema: 'evidence/v1' })).toEqual([
      '$.schema: evidence/v1 is no longer accepted; evidence/v2 orders events by their position in the transcript (see docs/evidence.md)',
    ]);
    expect(errorsOf({ ...clone(), schema: 'evidence/v3' })).toEqual(['$.schema: expected "evidence/v2", got "evidence/v3"']);
    const r = parseEvidence('{ nope');
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.errors[0]).toMatch(/^\$: invalid JSON/);
  });
});
