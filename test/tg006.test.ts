// TG006's reading of hand-built evidence, and the claim context on tampering
// findings, for the branches the fixtures reach only indirectly.
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/check.js';
import { EVIDENCE_SCHEMA_ID, type Edit, type Evidence, type Run } from '../src/evidence/schema.js';
import { judgeSuiteClaim, pathRelevance } from '../src/rules/TG006.js';
import type { RepoModel } from '../src/location.js';

const run = (seq: number, over: Partial<Run> = {}): Run => ({
  id: `r${seq}`,
  seq,
  command: 'npm test',
  recognized: true,
  framework: 'vitest',
  selection: 'full',
  cwd: '',
  exit_code: 0,
  exit_unknown: null,
  source: 'transcript',
  tree_sha: null,
  summary: { passed: 6, failed: 0, skipped: 0 },
  tests: [],
  output_sha256: '0'.repeat(64),
  output_truncated: false,
  ...over,
});
const edit = (seq: number, over: Partial<Edit> = {}): Edit => ({ seq, path: 'src/a.ts', certainty: 'certain', via: 'edit_tool', command: null, ...over });
const evidence = (runs: Run[], edits: Edit[], complete = true): Evidence => ({
  schema: EVIDENCE_SCHEMA_ID,
  agent: { name: 'claude-code', version: '', session_id: '' },
  repo: { base: null, head: null },
  transcript: { format: null, complete, issues: complete ? [] : ['unknown tool "mcp__x"'] },
  claims: [{ id: 'c1', kind: 'suite_passed', text: 'All tests pass.', source: 'last_assistant_message', certainty: 'certain', seq: 99 }],
  runs,
  edits,
});

/** What TG006 says: `contradicted` (a WARN the visible evidence states in every order), `warn`, or `info`. */
const outcome = (ev: Evidence): string | undefined => {
  const j = judgeSuiteClaim(ev);
  return j === null ? undefined : j.contradicted ? 'contradicted' : j.severity;
};

describe('judgeSuiteClaim', () => {
  it('orders by seq, not by array order', () => {
    expect(outcome(evidence([run(5)], [edit(3)]))).toBe('info');
    expect(outcome(evidence([run(3)], [edit(5)]))).toBe('contradicted');
  });

  it('never a FAIL and never a PASS: at most a WARN, at best an INFO consistent_unverified', () => {
    expect(judgeSuiteClaim(evidence([run(3, { exit_code: 1, summary: { passed: 5, failed: 1, skipped: 0 } })], []))!.severity).toBe('warn');
    expect(judgeSuiteClaim(evidence([], []))!.severity).toBe('warn');
    const ok = judgeSuiteClaim(evidence([run(3)], []))!;
    expect([ok.severity, ok.reason]).toEqual(['info', 'consistent_unverified']);
    expect(ok.message).toMatch(/consistent with what is visible, not verified/);
    expect(ok.message).not.toMatch(/\bbacked\b|\bverified by\b/);
  });

  it('a command after the last recognised run that might be a test run makes it uncertain', () => {
    const later = run(7, { command: 'make test', recognized: false, framework: 'unknown', selection: 'unknown', exit_code: 0 });
    expect(outcome(evidence([run(3, { exit_code: 1 }), later], []))).toBe('warn');
    expect(outcome(evidence([run(3), later], [edit(5)]))).toBe('warn');
    // …but not what no later run can undo: an edit after it.
    expect(outcome(evidence([run(3), later], [edit(9)]))).toBe('contradicted');
  });

  it("the runner's output decides", () => {
    // A summary with failures is a failed run whatever the exit status (`vitest run || exit 0`).
    expect(outcome(evidence([run(3, { exit_code: 0, summary: { passed: 6, failed: 1, skipped: 0 } })], []))).toBe('contradicted');
    // No recognised summary shows nothing, even with exit 0 (`echo`, `vitest list`, `--if-present`).
    expect(outcome(evidence([run(3, { exit_code: 0, summary: null })], []))).toBe('warn');
    // No test ran.
    expect(outcome(evidence([run(3, { exit_code: 0, summary: { passed: 0, failed: 0, skipped: 2 } })], []))).toBe('warn');
    // A pipe hides the exit status: a complete green summary is consistent with the claim.
    expect(outcome(evidence([run(3, { exit_code: null, exit_unknown: 'pipe' })], []))).toBe('info');
    // Another command in a chain decides the status.
    expect(outcome(evidence([run(3, { exit_code: null, exit_unknown: 'chain' })], []))).toBe('warn');
    expect(outcome(evidence([run(3, { exit_code: null, exit_unknown: 'background' })], []))).toBe('warn');
    // Only the runner's summary shows a failure: a green summary with a failing exit, or an exit status alone.
    expect(outcome(evidence([run(3, { exit_code: 1 })], []))).toBe('warn');
    expect(outcome(evidence([run(3, { exit_code: 1, summary: null })], []))).toBe('warn');
    // The summary shows a deselection: the run is partial.
    expect(outcome(evidence([run(3, { summary: { passed: 1, failed: 0, skipped: 0, partial: true } })], []))).toBe('warn');
    // Output cut: said as a fact, whatever the rest shows.
    expect(judgeSuiteClaim(evidence([run(3, { output_truncated: true })], []))!.warnReasons).toEqual(['output_truncated']);
  });

  it('warnings describe facts for the reviewer, without accusing', () => {
    const msg = (ev: Evidence): string => judgeSuiteClaim(ev)!.message;
    expect(msg(evidence([run(3, { summary: { passed: 5, failed: 1, skipped: 0 } })], []))).toMatch(/^The agent said "All tests pass\."; last visible test run failed: `npm test` \(exit 0, 5 passed, 1 failed\)$/);
    expect(msg(evidence([run(3)], [edit(5)]))).toMatch(/no test run visible after the last edit: `src\/a\.ts` was edited after `npm test`/);
    expect(msg(evidence([], []))).toMatch(/no test run visible$/);
    expect(msg(evidence([run(3, { output_truncated: true })], []))).toMatch(/output truncated: the last visible test run `npm test`/);
    for (const m of [msg(evidence([], [])), msg(evidence([run(3)], [edit(5)]))]) expect(m).not.toMatch(/\bbut\b|claims the suite passes|To do/);
  });

  it("a claim's certainty does not change the severity", () => {
    const ev = evidence([run(3, { exit_code: 1 })], [edit(5)]);
    ev.claims[0]!.certainty = 'possible';
    expect(outcome(ev)).toBe('contradicted');
    expect(judgeSuiteClaim(ev)!.severity).toBe('warn');
    ev.claims = [];
    expect(judgeSuiteClaim(ev)).toBeNull();
  });

  it('an incomplete transcript is a WARN, and says so', () => {
    expect(judgeSuiteClaim(evidence([], [], false))!.severity).toBe('warn');
    expect(judgeSuiteClaim(evidence([run(3)], [], false))!.warnReasons).toEqual(['incomplete_transcript']);
  });

  it('docs after the run are ignored; any other file counts; uncertain edits and paths that cannot be placed are uncertain', () => {
    expect(outcome(evidence([run(3)], [edit(5, { path: 'README.md' })]))).toBe('info');
    expect(outcome(evidence([run(3)], [edit(5, { path: '.github/workflows/ci.yml' })]))).toBe('contradicted');
    expect(outcome(evidence([run(3)], [edit(5, { path: 'test/fixtures/value.txt' })]))).toBe('contradicted');
    expect(outcome(evidence([run(3)], [edit(5, { path: 'C:/elsewhere/a.ts' })]))).toBe('warn');
    expect(outcome(evidence([run(3)], [edit(5, { path: '/tmp/scratch.py' }), edit(6)]))).toBe('contradicted');
    // with no model of the repository no directory is known, so a `..` cannot be resolved
    expect(outcome(evidence([run(3)], [edit(5, { path: 'docs/../src/a.js' })]))).toBe('warn');
    expect(outcome(evidence([run(3)], [edit(5, { path: 'docs/./guide.txt' })]))).toBe('info');
    expect(outcome(evidence([run(3)], [edit(5, { path: null, certainty: 'uncertain', via: 'shell', command: 'sed -i x src/a.ts' })]))).toBe('warn');
  });

  it('path relevance: only documentation is irrelevant, an explicit list', () => {
    expect(['src/a.ts', 'tests/test_a.py', 'package.json', 'vitest.config.ts', 'conftest.py', 'pytest.ini', 'a.png', 'notes.txt', 'data/fixture.json'].map((p) => pathRelevance(p))).toEqual(Array(9).fill('code'));
    expect(['README.md', 'docs/x.rst', 'docs/guide.txt', 'LICENSE', 'LICENSE.txt', 'CHANGELOG.md', 'pkg/CHANGELOG'].map((p) => pathRelevance(p))).toEqual(Array(7).fill('doc'));
    // never inside a test or fixtures directory
    expect(['test/fixtures/expected.md', 'tests/README.md', 'docs/fixtures/a.md', 'src/__snapshots__/a.md', 'spec/LICENSE'].map((p) => pathRelevance(p))).toEqual(Array(5).fill('code'));
    // a path that cannot be placed in the repository with certainty may or may not be one of its files
    expect(['C:/elsewhere/a.ts', '/tmp/a.py', '<REPO>/docs/a.md'].map((p) => pathRelevance(p))).toEqual(['unplaced', 'unplaced', 'unplaced']);
  });

  it('paths are resolved one component at a time in base and head, with and without case: ubicar es certeza o no es', () => {
    const tree = (files: string[], symlinks: string[] = [], submodules: string[] = []) => ({ files: new Set(files), symlinks: new Set(symlinks), submodules: new Set(submodules) });
    const model: RepoModel = {
      trees: [tree(['src/a.js', 'docs/guide.txt', 'docs/tmp/.keep', 'test/a.test.js'], ['docs/link'], ['vendor/sub']), tree(['src/a.js', 'docs/guide.txt', 'docs/tmp/.keep', 'test/a.test.js'], [], ['vendor/sub'])],
    };
    // `.` and `..` over known directories
    expect(['docs/../src/a.js', './docs/../test/x.md', 'src/./b.ts'].map((p) => pathRelevance(p, model))).toEqual(Array(3).fill('code'));
    expect(['docs/./guide.txt', 'src/../docs/guide.txt', './README.md', 'docs/tmp/../guide.txt'].map((p) => pathRelevance(p, model))).toEqual(Array(4).fill('doc'));
    // `..` after something that is not a known directory, or above the root: unplaced
    expect(['new/../docs/a.md', 'README.md/../src/a.ts', 'docs/../../x.md', '../README.md'].map((p) => pathRelevance(p, model))).toEqual(Array(4).fill('unplaced'));
    // a symlink in base or in head, a submodule: unplaced, even when a `..` would step back out of it
    expect(['docs/link/a.md', 'docs/link', 'docs/tmp/../link/../a.js', 'vendor/sub/README.md'].map((p) => pathRelevance(p, model))).toEqual(Array(4).fill('unplaced'));
    // a spelling that is another file on a case-insensitive file system: unplaced
    expect(['DOCS/guide.txt', 'Src/a.js', 'Test/expected.md'].map((p) => pathRelevance(p, model))).toEqual(Array(3).fill('unplaced'));
    // a new name with no case twin is the same everywhere
    expect(pathRelevance('Notes/todo.md', model)).toBe('doc');
    // `\` is a separator on Windows and a character elsewhere: unplaced
    expect(['docs\\guide.txt', 'docs\\..\\src\\a.js'].map((p) => pathRelevance(p, model))).toEqual(['unplaced', 'unplaced']);
    // with no model (scan-history), no directory is known: any `..` is unplaced
    expect(['src/../docs/guide.txt', 'docs/guide.txt'].map((p) => pathRelevance(p))).toEqual(['unplaced', 'doc']);
  });

  it('an edit is after the run only past its end; one that overlaps it is uncertain', () => {
    // The run started at 3 and its result came at 7 (another call ran in between).
    const long = run(3, { seq_end: 7 });
    expect(outcome(evidence([long], [edit(5)]))).toBe('warn');
    expect(outcome(evidence([long], [edit(8)]))).toBe('contradicted');
    expect(outcome(evidence([long], [edit(1)]))).toBe('info');
    // An edit that started before the run and ended after it started overlaps it too.
    expect(outcome(evidence([run(3)], [edit(2, { seq_end: 4 })]))).toBe('warn');
    expect(judgeSuiteClaim(evidence([long], [edit(5)]))!.warnReasons).toEqual(['overlapping_edit']);
  });

  it('a run counts only where it is placed in the repository: its directory known and inside it', () => {
    // A green run in another repository or in a directory the transcript does not record says nothing here…
    expect(outcome(evidence([run(3, { cwd: null })], []))).toBe('warn');
    expect(outcome(evidence([run(3, { cwd: 'C:/other/repo' })], []))).toBe('warn');
    expect(outcome(evidence([run(3, { cwd: '../other' })], []))).toBe('warn');
    // …nor does a failing one, or hide the target's failure
    expect(outcome(evidence([run(3, { cwd: null, exit_code: 1, summary: { passed: 5, failed: 1, skipped: 0 } })], []))).toBe('warn');
    expect(outcome(evidence([run(3, { exit_code: 1, summary: { passed: 5, failed: 1, skipped: 0 } }), run(5, { cwd: '/elsewhere' })], []))).toBe('warn');
    expect(judgeSuiteClaim(evidence([run(3, { cwd: null })], []))!.warnReasons).toEqual(['unplaced_run']);
    // a subdirectory of the repository is placed, but which project and which tests a run there ran is not known
    expect(outcome(evidence([run(3, { cwd: 'packages/a' })], []))).toBe('warn');
    expect(judgeSuiteClaim(evidence([run(3, { cwd: 'packages/a' })], []))!.warnReasons).toEqual(['filtered_run']);
    expect(outcome(evidence([run(3, { cwd: 'packages/a', exit_code: 1, summary: { passed: 5, failed: 1, skipped: 0 } })], []))).toBe('contradicted');
    // a certain edit after every run, wherever the runs were
    expect(outcome(evidence([run(3, { cwd: null })], [edit(5)]))).toBe('contradicted');
  });

  it('the same reading for a transcript and for the recorder: neither verifies a claim', () => {
    for (const format of [null, 'claude-jsonl', 'claude-stream-json', 'codex-rollout', 'codex-exec-json'] as const) {
      const ev = { ...evidence([run(3)], []), transcript: { format, complete: true, issues: [] } };
      const j = judgeSuiteClaim(ev)!;
      expect([format, j.severity, j.reason]).toEqual([format, 'info', 'consistent_unverified']);
    }
  });
});

describe('claim context: a tampering finding keeps its severity and says the agent also claimed tests pass', () => {
  const base = "it('a', () => { expect(1).toBe(1); });\nit.skip('b', () => { expect(2).toBe(2); });\nit('c', () => { expect(3).toBe(3); });\n";
  const check = async (head: string, claim: Evidence['claims'][number] | null) => {
    const ev = evidence([run(1)], [edit(0, { path: 'x.test.ts' })]);
    ev.claims = claim ? [claim] : [];
    const report = await analyze({
      base: 'b'.repeat(40),
      head: 'h'.repeat(40),
      changes: [{ status: 'M', basePath: 'x.test.ts', headPath: 'x.test.ts' }],
      read: (side, path) => (path === 'x.test.ts' ? (side === 'base' ? base : head) : null),
      evidence: ev,
    });
    return report.findings.filter((f) => f.rule === 'TG001').map((f) => [f.severity, f.test, f.message.endsWith('(the agent also claimed tests pass: "All tests pass.")')]);
  };
  const claim = (over: Partial<Evidence['claims'][number]> = {}): Evidence['claims'][number] => ({ id: 'c1', kind: 'suite_passed', text: 'All tests pass.', source: 'last_assistant_message', certainty: 'certain', seq: 99, ...over });
  const deleted = base.replace("it('c', () => { expect(3).toBe(3); });\n", '');

  it('deleting a test that ran: WARN, with the claim as context; without a claim, the same WARN', async () => {
    expect(await check(deleted, claim())).toEqual([['warn', 'c', true]]);
    expect(await check(deleted, claim({ certainty: 'possible' }))).toEqual([['warn', 'c', true]]);
    expect(await check(deleted, null)).toEqual([['warn', 'c', false]]);
  });

  it("only the last turn's claim: an earlier turn's may describe another state", async () => {
    expect(await check(deleted, claim({ source: 'turn_end' }))).toEqual([['warn', 'c', false]]);
  });

  it('deleting a test that was already skipped: nothing that ran is gone, no context', async () => {
    const head = base.replace("it.skip('b', () => { expect(2).toBe(2); });\n", '');
    expect(await check(head, claim())).toEqual([['warn', 'b', false]]);
  });
});
