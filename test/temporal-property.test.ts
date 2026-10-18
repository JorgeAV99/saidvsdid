// TG006's temporal model against a brute-force oracle.
//
// Every run and every edit is an interval [seq, seq_end] of positions in the
// transcript; the claim is a point. An order of the events is compatible with
// their intervals when every event placed before another starts no later than
// that other one ends (closed intervals: sharing an endpoint allows both
// orders). The oracle enumerates every compatible order.
//
// TG006. In one order the claim is:
// - FALSE when no run comes before it, the last run before it failed (in the
//   repository), or a certain edit of a code file of the repository lies
//   between that run and the claim;
// - UNKNOWN when the last run's result says nothing about the repository (no
//   summary, not a recognised runner, filtered, or run in another or an unknown
//   directory: unplaced), or an uncertain edit lies between it and the claim (a
//   shell command that may write, an opaque tool, a path outside the
//   repository, through a symlink or in a submodule);
// - TRUE otherwise. Documentation edits do not count.
// The guarantee: TG006 is never more than a WARN (claims are warnings for the
// reviewer); it states a fact ("contradicted") only when the claim is false in
// every order, says "consistent, not verified" (INFO) only when it is true in
// every one, and warns with why it is not certain otherwise.
//
// Thousands of random traces (fixed seed) of 4–6 events, with overlapping
// intervals and shared endpoints: the categories of the reviews' 10,000 extra
// traces (unknown runs, filters, documentation, uncertain edits) plus run
// locations and opaque tools.
import { describe, expect, it } from 'vitest';
import { EVIDENCE_SCHEMA_ID, type Edit, type Evidence, type Run } from '../src/evidence/schema.js';
import type { RepoModel } from '../src/location.js';
import { judgeSuiteClaim } from '../src/rules/TG006.js';

const RUN_OUTCOMES = ['pass', 'fail', 'no-summary', 'unrecognised', 'filtered'] as const;
const RUN_PLACES = ['repo', 'other', 'unknown'] as const;
const EDIT_KINDS = ['certain', 'target', 'doc', 'shell', 'outside', 'symlink', 'submodule', 'opaque'] as const;
type Outcome = (typeof RUN_OUTCOMES)[number];
type Place = (typeof RUN_PLACES)[number];
type EditKind = (typeof EDIT_KINDS)[number];

interface Interval {
  kind: 'run' | 'edit' | 'claim';
  s: number;
  e: number;
  outcome?: Outcome;
  place?: Place;
  edit?: EditKind;
}

/** A test file the traces may edit; `lib` is a symlink and `vendor/toolkit` a submodule of the repository. */
const TARGET = 'test/x.test.ts';
const MODEL: RepoModel = {
  trees: [{ files: new Set(['src/a.ts', TARGET, 'README.md']), symlinks: new Set(['lib']), submodules: new Set(['vendor/toolkit']) }],
};

/** Calls `atClaim` with the events before the claim, for every compatible order (up to the claim); false stops. */
function orders(events: Interval[], atClaim: (before: Interval[]) => boolean): void {
  const n = events.length;
  const placed: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  let stop = false;
  const visit = (): void => {
    for (let x = 0; x < n && !stop; x++) {
      // x can come next only if everything placed so far starts no later than x ends.
      if (used[x] || placed.some((p) => events[p]!.s > events[x]!.e)) continue;
      if (events[x]!.kind === 'claim') {
        // The rest can follow the claim (sorted by start) only if it ends no earlier than every placed event starts.
        const ok = events.every((ev, y) => used[y] || y === x || (placed.every((p) => events[p]!.s <= ev.e) && events[x]!.s <= ev.e));
        if (ok && !atClaim(placed.map((p) => events[p]!))) stop = true;
        continue;
      }
      used[x] = true;
      placed.push(x);
      visit();
      placed.pop();
      used[x] = false;
    }
  };
  visit();
}

type Truth = 'true' | 'false' | 'unknown';

/** The values the claim takes over every compatible order. */
function oracle(events: Interval[]): Set<Truth> {
  const values = new Set<Truth>();
  orders(events, (before) => {
    let last: Interval | null = null;
    let certainAfter = false;
    let uncertainAfter = false;
    for (const ev of before) {
      if (ev.kind === 'run') {
        last = ev;
        certainAfter = uncertainAfter = false;
      } else if (ev.edit === 'certain' || ev.edit === 'target') certainAfter = true;
      else if (ev.edit !== 'doc') uncertainAfter = true;
    }
    const result = !last ? 'none' : last.place !== 'repo' ? 'unknown' : last.outcome === 'pass' ? 'pass' : last.outcome === 'fail' ? 'fail' : 'unknown';
    values.add(result === 'none' || result === 'fail' || certainAfter ? 'false' : result === 'unknown' || uncertainAfter ? 'unknown' : 'true');
    return values.size < 3;
  });
  return values;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function trace(next: () => number, weights: { target: number }): Interval[] {
  const int = (k: number): number => Math.floor(next() * k);
  const events: Interval[] = [];
  const count = 3 + int(3); // 3–5 runs and edits, plus the claim: 4–6 events
  for (let i = 0; i < count; i++) {
    const s = int(10);
    // About half are points; the rest span a few positions (overlaps, shared endpoints).
    const e = next() < 0.5 ? s : s + 1 + int(4);
    if (next() < 0.5) {
      const outcome: Outcome = next() < 0.75 ? (next() < 0.6 ? 'pass' : 'fail') : RUN_OUTCOMES[2 + int(3)]!;
      const place: Place = next() < 0.8 ? 'repo' : RUN_PLACES[1 + int(2)]!;
      events.push({ kind: 'run', s, e, outcome, place });
    } else {
      const r = next();
      const edit: EditKind = r < weights.target ? 'target' : r < 0.55 ? 'certain' : EDIT_KINDS[2 + int(EDIT_KINDS.length - 2)]!;
      events.push({ kind: 'edit', s, e, edit });
    }
  }
  const c = int(12);
  events.push({ kind: 'claim', s: c, e: c });
  return events;
}

const EDIT_RECORDS: Record<EditKind, Pick<Edit, 'path' | 'certainty' | 'via' | 'command' | 'placed'>> = {
  certain: { path: 'src/a.ts', certainty: 'certain', via: 'edit_tool', command: null },
  target: { path: TARGET, certainty: 'certain', via: 'edit_tool', command: null },
  doc: { path: 'README.md', certainty: 'certain', via: 'edit_tool', command: null },
  shell: { path: null, certainty: 'uncertain', via: 'shell', command: 'sed -i s/a/b/ src/a.ts' },
  outside: { path: '/tmp/scratch.py', certainty: 'certain', via: 'patch', command: null, placed: false },
  symlink: { path: 'lib/a.ts', certainty: 'certain', via: 'edit_tool', command: null },
  submodule: { path: 'vendor/toolkit/index.js', certainty: 'certain', via: 'patch', command: null },
  opaque: { path: null, certainty: 'uncertain', via: 'opaque', command: 'tool mcp__workspace__apply_edit' },
};

function evidenceOf(events: Interval[]): Evidence {
  const runs: Run[] = [];
  const edits: Edit[] = [];
  let claimSeq = 0;
  events.forEach((ev, i) => {
    const span = ev.e > ev.s ? { seq_end: ev.e } : {};
    if (ev.kind === 'claim') claimSeq = ev.s;
    else if (ev.kind === 'edit') edits.push({ seq: ev.s, ...span, ...EDIT_RECORDS[ev.edit!] });
    else {
      const o = ev.outcome!;
      runs.push({
        id: `r${i}`,
        seq: ev.s,
        ...span,
        command: o === 'unrecognised' ? 'make test' : o === 'filtered' ? 'npx vitest run test/a.test.ts' : 'npm test',
        recognized: o !== 'unrecognised',
        framework: o === 'unrecognised' ? 'unknown' : 'vitest',
        selection: o === 'unrecognised' ? 'unknown' : o === 'filtered' ? 'filtered' : 'full',
        cwd: ev.place === 'repo' ? '' : ev.place === 'other' ? '/home/agent/other-checkout' : null,
        exit_code: o === 'fail' ? 1 : 0,
        exit_unknown: null,
        source: 'transcript',
        tree_sha: null,
        summary: o === 'no-summary' || o === 'unrecognised' ? null : { passed: o === 'fail' ? 5 : 6, failed: o === 'fail' ? 1 : 0, skipped: 0 },
        tests: [],
        output_sha256: '0'.repeat(64),
        output_truncated: false,
      });
    }
  });
  return {
    schema: EVIDENCE_SCHEMA_ID,
    agent: { name: 'claude-code', version: '', session_id: '' },
    repo: { base: null, head: null },
    transcript: { format: null, complete: true, issues: [] },
    claims: [{ id: 'c1', kind: 'suite_passed', text: 'All tests pass.', source: 'last_assistant_message', certainty: 'certain', seq: claimSeq }],
    runs,
    edits,
  };
}

const show = (events: Interval[]): string =>
  events
    .map((e) => `${e.kind === 'run' ? `${e.outcome}@${e.place}` : e.kind === 'edit' ? `edit:${e.edit}` : 'claim'}[${e.s}${e.e > e.s ? `,${e.e}` : ''}]`)
    .join(' ');

const values = (events: Interval[]): Truth[] => [...oracle(events)].sort();
const run = (s: number, e: number, outcome: Outcome = 'pass', place: Place = 'repo'): Interval => ({ kind: 'run', s, e, outcome, place });
const edit = (s: number, e: number, kind: EditKind = 'certain'): Interval => ({ kind: 'edit', s, e, edit: kind });
const claim = (c: number): Interval => ({ kind: 'claim', s: c, e: c });

describe('the temporal model against a brute-force oracle', () => {
  it('the oracle itself, on the cases of the reviews', () => {
    // A starts, B starts and passes, A ends failing.
    expect(values([run(1, 4, 'fail'), run(2, 3), claim(5)])).toEqual(['false', 'true']);
    // A run still running at the claim: no future evidence, and no retroactive FAIL.
    expect(values([run(1, 6), claim(5)])).toEqual(['false', 'true']);
    expect(values([run(1, 1), run(2, 6, 'fail'), claim(5)])).toEqual(['false', 'true']);
    // Nothing that starts after the claim counts.
    expect(values([run(1, 1), run(6, 6, 'fail'), edit(7, 7), claim(5)])).toEqual(['true']);
    // An uncertain edit after the last passing run: unknown, never false; a certain one beside it: false.
    for (const kind of ['shell', 'outside', 'symlink', 'submodule', 'opaque'] as const) expect(values([run(1, 1), edit(2, 2, kind), claim(5)])).toEqual(['unknown']);
    expect(values([run(1, 1), edit(2, 2, 'outside'), edit(3, 3), claim(5)])).toEqual(['false']);
    // F1: a run in another or an unknown directory says nothing: it neither backs the claim nor hides a failure.
    expect(values([run(1, 1, 'fail'), run(2, 2, 'pass', 'other'), claim(5)])).toEqual(['unknown']);
    expect(values([run(1, 1, 'pass', 'unknown'), claim(5)])).toEqual(['unknown']);
    // Documentation does not count.
    expect(values([run(1, 1), edit(2, 2, 'doc'), claim(5)])).toEqual(['true']);
  });

  it('TG006: INFO only when every order makes the claim true, a contradicted WARN only when every order makes it false', () => {
    const next = rng(20261002);
    const broken: string[] = [];
    const seen = { pass: 0, warn: 0, fail: 0, unknown: 0, unplacedRun: 0, unknownRun: 0, doc: 0, opaque: 0 };
    for (let i = 0; i < 8000; i++) {
      const events = trace(next, { target: 0 });
      const v = oracle(events);
      const j = judgeSuiteClaim(evidenceOf(events), MODEL)!;
      const severity = j.contradicted ? 'fail' : j.severity;
      if (j.severity !== 'warn' && j.severity !== 'info') broken.push(`${show(events)}: TG006 ${j.severity}, more than a WARN`);
      const want = v.size === 1 && v.has('true') ? 'info' : v.size === 1 && v.has('false') ? 'fail' : 'warn';
      seen[want === 'info' ? 'pass' : want]++;
      if (v.has('unknown')) seen.unknown++;
      if (events.some((e) => e.kind === 'run' && e.place !== 'repo')) seen.unplacedRun++;
      if (events.some((e) => e.kind === 'run' && e.outcome !== 'pass' && e.outcome !== 'fail')) seen.unknownRun++;
      if (events.some((e) => e.edit === 'doc')) seen.doc++;
      if (events.some((e) => e.edit === 'opaque')) seen.opaque++;
      if (severity !== want) broken.push(`${show(events)}: oracle ${[...v].join('/')} → ${want}, TG006 ${severity}`);
      // The same trace read from a transcript: the same reading.
      const fromTranscript = judgeSuiteClaim({ ...evidenceOf(events), transcript: { format: 'claude-jsonl', complete: true, issues: [] } }, MODEL)!;
      const wantTranscript = want === 'info' ? 'info consistent_unverified' : 'warn';
      if (`${fromTranscript.severity}${fromTranscript.severity === 'info' ? ` ${fromTranscript.reason}` : ''}` !== wantTranscript) {
        broken.push(`${show(events)} (transcript): ${wantTranscript} expected, TG006 ${fromTranscript.severity} ${fromTranscript.reason}`);
      }
    }
    expect(broken.slice(0, 10)).toEqual([]);
    // The generator reaches every outcome and every category often.
    expect(Math.min(...Object.values(seen))).toBeGreaterThan(300);
  });
});
