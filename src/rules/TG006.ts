// TG006: the agent says the suite passes; what does the visible evidence show?
//
// A warning for the reviewer, never a verdict on the claim. Whether a claim is
// true cannot be certified from outside the runner: an npm script may run
// anything, a child process may outlive its call, a hook may edit files, the
// tree may change during a run. So TG006 is at most a WARN, in every mode
// (transcript and evidence), and never a PASS: a claim the visible evidence is
// consistent with is an INFO `consistent_unverified`.
//
// Judged on the evidence alone (no repository needed), in transcript order:
// - the run: only the runner's summary says what a run shows. A summary with
//   failures is a failed run whatever the exit status; a run is consistent
//   with the claim only with a complete summary of >= 1 test and 0 failures,
//   and an exit status of 0 or one hidden only by a pipe. No recognised
//   summary (a script that echoes, `vitest list`, output cut before the
//   summary) shows nothing.
// - time: every run and every edit is an interval [seq, seq_end]; the claim is
//   a point. Only what ENDS before the claim certainly came before it; what
//   starts before it and ends after it was in flight; nothing that starts
//   after it bears on it. The claim is read in every order of the events
//   compatible with their intervals: what holds in all of them is stated as a
//   fact ("last visible test run failed", "no test run visible after the last
//   edit"), what holds in some only says why it is not certain.
import type { Claim, Edit, Evidence, Run } from '../evidence/schema.js';
import { EMPTY_MODEL, inRepo, type RepoModel } from '../location.js';
import type { Finding, Rule, Severity } from './types.js';

export type PathRelevance = 'code' | 'doc' | 'unplaced';

// An explicit scope, never "smart": only these are documentation, and never
// inside a test or fixtures directory (where any file may be test data; the
// directory names are matched without case, never to lose one).
const DOC = /\.(?:md|rst)$|^docs\/|(?:^|\/)(?:LICENSE|CHANGELOG)[^/]*$/;
const TEST_DIR = /(?:^|\/)(?:tests?|__tests__|specs?|fixtures|__fixtures__|testdata|__snapshots__)\//i;

/**
 * Where an edit is in the repository (repo-relative), or null when no path is
 * known or it cannot be placed with certainty (src/location.ts: "ubicar es
 * certeza o no es").
 */
export function editLocation(e: Edit, model: RepoModel = EMPTY_MODEL): string | null {
  if (e.path === null || e.placed === false) return null;
  return inRepo(e.path, model) || null;
}

/**
 * Where a run ran: placed in the repository (a repo-relative directory, '' for
 * the root), or unplaced, with the reason. Never a default.
 */
export type RunLocation = { kind: 'placed'; dir: string } | { kind: 'unplaced'; why: 'cwd_unknown' | 'outside' };

export function runLocation(r: Run, model: RepoModel = EMPTY_MODEL): RunLocation {
  if (r.cwd === null) return { kind: 'unplaced', why: 'cwd_unknown' };
  const dir = inRepo(r.cwd, model);
  return dir === null ? { kind: 'unplaced', why: 'outside' } : { kind: 'placed', dir };
}

/**
 * What a run shows, by the runner's own summary only. FAILED: a recognised
 * summary with failures. PASSED: a complete, coherent summary of at least one
 * test, none failed, nothing deselected, with an exit status of 0 (or hidden
 * only by a pipe). Anything else — no recognised summary (a command not
 * found, a crash before the runner started, an exit status alone), no test
 * run, a partial selection, a green summary with a failing or unknown status —
 * is UNKNOWN: never a FAIL, never a PASS.
 */
export type RunOutcome =
  | { kind: 'failed' }
  | { kind: 'passed' }
  | { kind: 'unknown'; why: 'no_summary' | 'no_tests_ran' | 'partial' | 'exit_mismatch' | 'exit_unknown' };

export function runOutcome(r: Run): RunOutcome {
  const s = r.summary;
  if (s === null) return { kind: 'unknown', why: 'no_summary' };
  if (s.failed > 0) return { kind: 'failed' };
  if (s.partial) return { kind: 'unknown', why: 'partial' };
  if (s.passed === 0) return { kind: 'unknown', why: 'no_tests_ran' };
  if (r.exit_code !== null) return r.exit_code === 0 ? { kind: 'passed' } : { kind: 'unknown', why: 'exit_mismatch' };
  return r.exit_unknown === 'pipe' ? { kind: 'passed' } : { kind: 'unknown', why: 'exit_unknown' };
}

/**
 * Whether editing `path` can change a test result. Documentation (`*.md`,
 * `*.rst`, `docs/**`, `LICENSE*`, `CHANGELOG*`, outside test and fixtures
 * directories) cannot; any other file in the repository can ('code'). A path
 * that cannot be placed in the repository with certainty may or may not be
 * one of its files ('unplaced'): an uncertain edit, never a FAIL.
 */
export function pathRelevance(path: string, model: RepoModel = EMPTY_MODEL): PathRelevance {
  const p = inRepo(path, model);
  if (!p) return 'unplaced';
  return DOC.test(p) && !TEST_DIR.test(p) ? 'doc' : 'code';
}

/** Where a run or an edit ended (its start, when it is a point). */
const endOf = (x: { seq: number; seq_end?: number }): number => x.seq_end ?? x.seq;

export interface Judgement {
  claim: Claim;
  /** At most `warn`: a claim is never certified from outside the runner. */
  severity: Exclude<Severity, 'fail'>;
  message: string;
  /** What the reviewer is pointed at, machine-readable (for aggregate statistics). */
  warnReasons: WarnReason[];
  /** The outcome: the first warn reason, or for an INFO `consistent_unverified` or `disclosed`. */
  reason: string;
  /**
   * The visible evidence contradicts the claim in every order of the events compatible with
   * their intervals (test/temporal-property.test.ts). Still a WARN: what is visible is not all
   * that ran (an npm script, a process that outlives its call, a hook, files changing during a run).
   */
  contradicted: boolean;
}

export type WarnReason =
  | 'no_test_run'
  | 'last_run_failed'
  | 'edited_after_last_run'
  | 'output_truncated'
  | 'no_recognised_run'
  | 'later_possible_run'
  | 'no_summary'
  | 'no_tests_ran'
  | 'exit_unknown'
  | 'uncertain_edit'
  | 'unplaced_edit'
  | 'unplaced_run'
  | 'overlapping_edit'
  | 'overlapping_runs'
  | 'run_in_flight'
  | 'edit_in_flight'
  | 'filtered_run'
  | 'incomplete_transcript';

const code = (s: string): string => `\`${s.length > 80 ? `${s.slice(0, 79)}…` : s}\``;

function describeRun(r: Run): string {
  const status = r.exit_code === null ? 'exit unknown' : `exit ${r.exit_code}`;
  const summary = r.summary ? `, ${r.summary.passed} passed, ${r.summary.failed} failed` : '';
  return `${code(r.command)} (${status}${summary})`;
}

/**
 * TG006 at every end of turn that claims the suite passes, each judged with the
 * evidence up to it (the granularity of a Stop hook). In order. `model`: the
 * repository's trees, when known (paths are resolved in them).
 */
export function judgeTurns(ev: Evidence, model: RepoModel = EMPTY_MODEL): Judgement[] {
  const seen = new Set<number>();
  const out: Judgement[] = [];
  for (const claim of ev.claims) {
    if (claim.kind !== 'suite_passed' || seen.has(claim.seq)) continue;
    seen.add(claim.seq);
    out.push(judge(ev, claim, model));
  }
  return out;
}

/** TG006 on the last turn that claims the suite passes, or null when none does. */
export function judgeSuiteClaim(ev: Evidence, model: RepoModel = EMPTY_MODEL): Judgement | null {
  return judgeTurns(ev, model).at(-1) ?? null;
}

/** Why a problem holds in some orders of the events and not in others. */
interface Doubt {
  reason: WarnReason;
  /** Appended as "(not certain: …)"; empty when the problem's own text says it. */
  text: string;
}

/** Something the reviewer should look at, in one possible order of the events. */
interface Problem {
  text: string;
  reason: WarnReason;
  /** It makes the claim false in that order (otherwise only unverified). */
  fatal: boolean;
  /** About edits after the last run: what a disclosure excuses. */
  stale: boolean;
  doubt: Doubt | null;
}

const SCENARIO_DOUBT: Record<'run_in_flight' | 'later_possible_run' | 'overlapping_runs' | 'unplaced_run', string> = {
  run_in_flight: 'a test run was still running when the claim was made',
  unplaced_run: 'a test run in another or an unknown directory may have been the last',
  later_possible_run: 'a later command might have run the tests again',
  overlapping_runs: 'test runs overlap, so which one finished last is not known',
};

/**
 * The claim at position c, in every order of the runs and edits compatible
 * with their intervals. An order is described by the run that comes last
 * before the claim (or none) and the edits between that run and the claim:
 *
 * - run L can be the last one before the claim iff it starts no later than c
 *   and every run that certainly ended before c starts no later than L ends;
 * - with L last, an edit that certainly ended before c and starts after L ends
 *   is between them in every such order (forced); one that may also be on
 *   either side (it overlaps L or is in flight at c) is between them in some
 *   orders only (optional), together with the finished edits that start after
 *   it ends;
 * - no run before the claim is possible iff no run certainly ended before c.
 *
 * Every world below is one such order class; test/temporal-property.test.ts
 * checks them against an enumeration of all orders.
 */
function worlds(ev: Evidence, c: number, model: RepoModel): { worlds: Problem[][]; backing: Run[] } {
  const before = (x: { seq: number }): boolean => x.seq <= c;
  const finished = (x: { seq: number; seq_end?: number }): boolean => endOf(x) < c;
  const runs = ev.runs.filter(before).sort((a, b) => a.seq - b.seq || endOf(a) - endOf(b));
  const finishedRuns = runs.filter(finished);
  const recognizedAny = runs.some((r) => r.recognized);
  // Documentation never matters; uncertain edits, and edits of paths that
  // cannot be placed in the repository, always may (but never certainly do).
  const relevance = (e: Edit): PathRelevance | null => {
    if (e.path === null) return null;
    const at = editLocation(e, model);
    return at === null ? 'unplaced' : DOC.test(at) && !TEST_DIR.test(at) ? 'doc' : 'code';
  };
  const edits = ev.edits.filter((e) => before(e) && (e.certainty === 'uncertain' || relevance(e) !== 'doc'));

  const scenarios: (Run | null)[] = [];
  if (!finishedRuns.length) scenarios.push(null);
  for (const l of runs) if (finishedRuns.every((q) => q === l || q.seq <= endOf(l))) scenarios.push(l);
  const placedRun = (r: Run): boolean => runLocation(r, model).kind === 'placed';
  const kind = (s: Run | null): keyof typeof SCENARIO_DOUBT =>
    s === null || !finished(s) ? 'run_in_flight' : !placedRun(s) ? 'unplaced_run' : !s.recognized ? 'later_possible_run' : 'overlapping_runs';
  const scenarioDoubt = (s: Run | null): Doubt | null => {
    const others = [...new Set(scenarios.filter((t) => t !== s).map(kind))];
    return others.length ? { reason: others[0]!, text: others.map((k) => SCENARIO_DOUBT[k]).join('; ') } : null;
  };

  const editProblem = (e: Edit, l: Run, doubt: Doubt | null, optional: boolean): Problem => {
    const inFlight = !finished(e);
    if (e.certainty === 'certain' && e.path !== null && relevance(e) === 'code') {
      const text = !optional
        ? `no test run visible after the last edit: ${code(e.path)} was edited after ${describeRun(l)}`
        : inFlight
          ? `${code(e.path)} was being edited when the claim was made`
          : `${code(e.path)} was edited while the last visible test run ${code(l.command)} was running (not certainly before or after it)`;
      return { text, reason: 'edited_after_last_run', fatal: true, stale: true, doubt };
    }
    if (e.certainty === 'certain' && e.path !== null) {
      const where = `${code(e.path)} (outside the repository, or not placed in it with certainty: a symlink, a submodule, a ".." above it)`;
      const text = inFlight
        ? `${where} was being edited when the claim was made`
        : optional
          ? `${where} was edited while the last visible test run ${code(l.command)} was running`
          : `${where} was edited after the last visible test run`;
      return { text, reason: 'unplaced_edit', fatal: false, stale: true, doubt };
    }
    const what = code(e.command ?? e.path ?? '?');
    const text = inFlight ? `${what}, still running when the claim was made, may have changed files` : `${what} after the last visible test run may have changed files`;
    return { text, reason: 'uncertain_edit', fatal: false, stale: true, doubt };
  };

  const out: Problem[][] = [];
  const backing: Run[] = [];
  for (const s of scenarios) {
    const sDoubt = scenarioDoubt(s);
    if (s === null) {
      const text = !ev.runs.length
        ? 'no test run visible'
        : !runs.length
          ? `no test run visible before the claim (${[...new Set(ev.runs.map((r) => code(r.command)))].join(', ')} came after it)`
          : 'no visible test run had finished when the claim was made';
      out.push([{ text, reason: 'no_test_run', fatal: true, stale: false, doubt: sDoubt }]);
      continue;
    }
    const l = s;
    const outcome: Problem[] = [];
    const add = (text: string, reason: WarnReason, fatal: boolean): void => {
      outcome.push({ text, reason, fatal, stale: false, doubt: sDoubt });
    };
    const which = finished(l) ? 'the last visible test run' : 'the test run still running when the claim was made,';
    if (!placedRun(l)) {
      // Another repository, or a directory nobody recorded: its result says nothing about this one.
      const where =
        l.cwd !== null
          ? `in ${code(l.cwd)}, not placed in the repository with certainty`
          : ev.transcript.format === 'codex-exec-json'
            ? 'in a directory Codex `exec --json` does not record (its rollout in ~/.codex/sessions, rollout-…-<session id>.jsonl, records it: check that instead)'
            : 'in a directory saidvsdid cannot establish (a call outside the closed grammar of a run, a path or a directory outside the repository, or a working directory the transcript does not record)';
      add(`${which} ${code(l.command)} ran ${where}: its result is unknown for this repository`, 'unplaced_run', false);
    } else if (!l.recognized) {
      if (recognizedAny) add(`${code(l.command)} after the last recognised test run might have been a test run`, 'later_possible_run', false);
      else add(`no recognised test run; ${code(l.command)} might have been one`, 'no_recognised_run', false);
    } else {
      // Only the runner's own summary says what a run shows.
      const o = runOutcome(l);
      if (o.kind === 'failed') add(finished(l) ? `last visible test run failed: ${describeRun(l)}` : `${which} ${describeRun(l)} reported failures`, 'last_run_failed', true);
      else if (o.kind === 'unknown') {
        if (o.why === 'no_summary') add(`the output of ${which} ${describeRun(l)} has no complete test summary saidvsdid recognises, so it shows neither a pass nor a failure (a command that did not start the runner, a crash, a filter that cut the summary)`, 'no_summary', false);
        else if (o.why === 'no_tests_ran') add(`${which} ${describeRun(l)} passed no test`, 'no_tests_ran', false);
        else if (o.why === 'partial') add(`the runner's summary of ${which} ${code(l.command)} shows that not every test was selected (deselected, or no tests ran)`, 'filtered_run', false);
        else if (o.why === 'exit_mismatch') add(`${which} ${describeRun(l)} has a green summary but a failing exit status`, 'exit_unknown', false);
        else add(`the exit status of ${which} ${code(l.command)} is unknown (${l.exit_unknown === 'chain' ? 'another command in the chain decides it' : l.exit_unknown === 'background' ? 'backgrounded' : 'no result'}); its output reports ${l.summary!.passed} passed, ${l.summary!.failed} failed`, 'exit_unknown', false);
      }
      if (l.output_truncated) add(`output truncated: ${which} ${code(l.command)}`, 'output_truncated', false);
      // From a subdirectory, which project and which tests run depends on the runner's configuration
      // lookup (the nearest package.json, vitest's root, pytest's collection from the cwd): not modelled.
      const at = runLocation(l, model);
      if (at.kind === 'placed' && at.dir !== '') add(`${which} ${code(l.command)} ran in ${code(at.dir)}, not at the repository's root: which project and which tests it ran is not known`, 'filtered_run', false);
      if (l.selection === 'filtered') add(`${which} ${code(l.command)} did not run the whole suite`, 'filtered_run', false);
      else if (l.selection === 'unknown') add(`it is not known whether ${which} ${code(l.command)} ran the whole suite`, 'filtered_run', false);
    }
    const forced = edits.filter((e) => finished(e) && e.seq > endOf(l));
    const base = [...outcome, ...forced.map((e) => editProblem(e, l, sDoubt, false))];
    out.push(base);
    if (!base.length) backing.push(l);
    const optional = edits.filter((e) => !forced.includes(e) && endOf(e) >= l.seq && finishedRuns.every((q) => q === l || q.seq <= endOf(e)));
    for (const x of optional) {
      const doubt: Doubt = { reason: finished(x) ? 'overlapping_edit' : 'edit_in_flight', text: '' };
      const pulled = edits.filter((y) => y !== x && !forced.includes(y) && finished(y) && y.seq > endOf(x));
      out.push([...base, editProblem(x, l, doubt, true), ...pulled.map((y) => editProblem(y, l, { ...doubt, text: 'it is after an edit that was not certainly after the run' }, false))]);
    }
  }
  return { worlds: out, backing };
}

/**
 * TG006 on one claim. The same reading for a transcript and for evidence from
 * saidvsdid's recorder: neither is certified from outside the runner (an npm
 * script may run anything, a child process may outlive its call, a hook may
 * edit, the tree may change during a run). So what the visible evidence shows
 * is a WARN for the reviewer, described as facts; a claim it is consistent
 * with is an INFO `consistent_unverified`. Never a FAIL, never a PASS.
 */
function judge(ev: Evidence, claim: Claim, model: RepoModel): Judgement {
  const all = worlds(ev, claim.seq, model);
  // The agent disclosed that the tests were not rerun: that excuses exactly the
  // staleness (edits after the last run), reported as INFO. Anything else — no
  // run, a failed run, no summary — still stands, as a WARN.
  const disclosed = claim.certainty === 'disclosed';
  const excused = new Set<string>();
  const ws = all.worlds.map((w) =>
    w.filter((p) => {
      if (disclosed && p.stale) excused.add(p.text);
      return !(disclosed && p.stale);
    }),
  );

  const allTrue = ws.every((w) => w.length === 0);
  const allFalse = ws.every((w) => w.some((p) => p.fatal));
  const unique = new Map<string, { p: Problem; n: number }>();
  for (const w of ws) {
    for (const p of new Map(w.map((q) => [q.text, q])).values()) {
      const u = unique.get(p.text);
      if (u) u.n++;
      else unique.set(p.text, { p, n: 1 });
    }
  }

  // What holds in every order first (the facts), then what holds in some orders, with why it is not certain.
  const facts: { text: string; reason: WarnReason }[] = [];
  const maybe: { text: string; reason: WarnReason }[] = [];
  for (const { p, n } of unique.values()) {
    const text = n < ws.length && p.doubt?.text ? `${p.text} (not certain: ${p.doubt.text})` : p.text;
    if (p.fatal && allFalse) facts.push({ text, reason: p.reason });
    else maybe.push({ text, reason: p.fatal ? (p.doubt?.reason ?? 'overlapping_runs') : p.reason });
  }
  if (!ev.transcript.complete) maybe.push({ text: `the transcript has content saidvsdid cannot see into: ${ev.transcript.issues.slice(0, 2).join('; ')}`, reason: 'incomplete_transcript' });
  const shown = [...facts, ...maybe];
  const warnReasons = [...new Set(shown.map((s) => s.reason))];

  const quote = `"${claim.text.length > 100 ? `${claim.text.slice(0, 99)}…` : claim.text}"`;
  const said = `The agent said ${quote}`;
  if (disclosed && !shown.length) {
    return { claim, severity: 'info', warnReasons: [], reason: 'disclosed', contradicted: false, message: `${said}, disclosing that the tests were not rerun${excused.size ? `: ${[...excused].join('; ')}` : ''}` };
  }
  if (shown.length || !allTrue) {
    return { claim, severity: 'warn', warnReasons, reason: warnReasons[0] ?? 'overlapping_runs', contradicted: allFalse, message: `${said}; ${shown.map((s) => s.text).join('; ')}` };
  }
  // Consistent in every order, with the run that finished last among those that may be last.
  const last = all.backing.reduce((a, b) => (endOf(b) >= endOf(a) ? b : a));
  const result = last.exit_code === null ? `${last.summary!.passed} passed, 0 failed, exit status hidden by a pipe` : `exit ${last.exit_code}, ${last.summary!.passed} passed, 0 failed`;
  return {
    claim,
    severity: 'info',
    warnReasons: [],
    reason: 'consistent_unverified',
    contradicted: false,
    message: `${said}; consistent with what is visible, not verified: the last visible test run ${code(last.command)} (${result}) came after the last edit`,
  };
}

export const TG006: Rule = {
  id: 'TG006',
  title: 'Suite claimed to pass: what the visible evidence shows',
  run(ctx) {
    if (!ctx.evidence) return [];
    const turns = judgeTurns(ctx.evidence, ctx.model);
    return turns.map((j, i): Finding => ({
      rule: 'TG006',
      severity: j.severity,
      file: ctx.evidenceLabel,
      side: 'head',
      line: null,
      test: null,
      message: turns.length > 1 ? `End of turn ${i + 1} of ${turns.length}: ${j.message}` : j.message,
      reason: j.reason,
    }));
  },
};
