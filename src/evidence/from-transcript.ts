// A parsed transcript → evidence/v2. Every run, edit and claim gets `seq`, its
// position in the transcript: one counter over events and, inside a shell
// command, over its segments (`npm test && sed -i …` puts the edit after the run).
import { createHash } from 'node:crypto';
import { extractClaims } from '../claims/extract.js';
import { classifySegment, parseSummary, segmentStatus, type Scripts } from '../transcript/commands.js';
import { callShape } from '../transcript/grammar.js';
import { segments, unwrap } from '../transcript/shell.js';
import type { Session } from '../transcript/types.js';
import { changeDir, knownCwd, Locator, NOT_RECORDED, type Cwd, type RepoModel } from '../location.js';
import { EVIDENCE_SCHEMA_ID, type Claim, type Edit, type Evidence, type Run } from './schema.js';

export interface FromTranscriptOptions {
  base?: string | null;
  head?: string | null;
  /**
   * Absolute paths of the repository under review. Only paths under one of
   * them (or the `<REPO>` marker of recorded sessions) are placed: no
   * matching by suffix, and the session's own working directory is not a root.
   */
  roots?: string[];
  /** The repository's trees at base and head: paths are resolved in them (src/location.ts). */
  model?: RepoModel;
  /**
   * The agent's working directory, for a transcript that does not record one
   * (Codex `exec --json`): explicit scope (`--cwd`). A transcript's own is used first.
   */
  cwd?: string | null;
  /** package.json scripts of a repo-relative directory ('' is the root), or null if unknown. */
  scripts?: (dir: string) => Scripts;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export function evidenceFromSession(session: Session, options: FromTranscriptOptions = {}): Evidence {
  const paths = new Locator(options.roots ?? [], options.model);
  // The transcript's own working directory; the one given explicitly only when
  // the format records none. An unreadable one stays unknown: never a guess.
  const sessionCwd: Cwd = session.cwd.kind === 'unknown' && session.cwd.why === NOT_RECORDED && options.cwd ? knownCwd(options.cwd) : session.cwd;
  // Claude Code's Bash keeps its working directory from one call to the next
  // (its documentation: "the working directory persists between commands"),
  // so it is followed call by call. A Codex rollout records the directory of
  // each command. Codex `exec --json` records none: the shell tool may run a
  // command in another `workdir`, so its runs are never placed (`--cwd` still
  // places the relative paths of its patches); its rollout, which `codex exec`
  // also writes, does record them.
  const persistent = session.agent === 'claude-code';
  let shellCwd: Cwd = sessionCwd;
  /** An edit of `path` from `cwd`: placed (repo-relative) or kept as written, marked unplaced. */
  const editPath = (path: string, cwd: Cwd): Pick<Edit, 'path' | 'placed'> => {
    const rel = paths.locate(path, cwd);
    return rel ? { path: rel } : { path, placed: false };
  };
  const runs: Run[] = [];
  const edits: Edit[] = [];
  /**
   * A call that is neither a recognised test run nor in the closed list of
   * non-executions (a script, make, node x.js, an opaque tool): it may have run
   * the tests. Its result is unknown and it is not placed.
   */
  const possibleRun = (seqAt: number, command: string, output: string, truncated: boolean): Run => ({
    id: `r${runs.length + 1}`,
    seq: seqAt,
    command,
    recognized: false,
    framework: 'unknown',
    selection: 'unknown',
    cwd: null,
    exit_code: null,
    exit_unknown: 'no_result',
    source: 'transcript',
    tree_sha: null,
    summary: null,
    tests: [],
    output_sha256: sha256(output),
    output_truncated: truncated,
  });
  // Every end of turn is a place where the agent may claim something.
  const turnIndexes = new Set(session.turnEnds.map((t) => t.index));
  const claimSeq = new Map<number, number>();
  let seq = 0;
  // Calls that overlap others (see Span): the gaps their start or end falls in
  // get a position of their own, assigned in order; the rest keeps its numbering.
  const gaps = new Set<number>();
  session.events.forEach((ev, i) => {
    if (ev.kind !== 'shell' && ev.kind !== 'edit' && ev.kind !== 'opaque') return;
    if (ev.start !== undefined && ev.start < i) gaps.add(ev.start);
    if (ev.end !== undefined && ev.end > i + 1) gaps.add(ev.end);
  });
  const gapSeq = new Map<number, number>();
  const fixups: (() => void)[] = [];
  /** Sets `seq` (from `start`) and `seq_end` (from `end`) of something an event produced, once every gap has its position. */
  const span = (x: { seq: number; seq_end?: number }, ev: { start?: number; end?: number }, i: number): void => {
    fixups.push(() => {
      const end = x.seq_end ?? x.seq;
      if (ev.start !== undefined && ev.start < i) x.seq = gapSeq.get(ev.start)!;
      const last = ev.end !== undefined && ev.end > i + 1 ? gapSeq.get(ev.end)! : end;
      if (last !== x.seq) x.seq_end = last;
    });
  };

  session.events.forEach((ev, index) => {
    if (gaps.has(index)) gapSeq.set(index, seq++);
    // A tool whose effects the transcript does not show (an MCP tool, a subagent,
    // an unknown item) may have changed any file: an uncertain edit, at its place.
    if (ev.kind === 'opaque' && ev.ran !== false) {
      const e: Edit = { seq, path: null, certainty: 'uncertain', via: 'opaque', command: ev.what };
      edits.push(e);
      // From its call to the end of the trace: no tool outside the closed lists is known to finish at its result.
      span(e, ev, index);
      // …and it may have run the tests.
      const r = possibleRun(seq, ev.what, '', false);
      runs.push(r);
      span(r, ev, index);
    }
    if (ev.kind === 'message' || ev.kind === 'opaque' || ev.kind === 'prompt') {
      if (turnIndexes.has(index)) claimSeq.set(index, seq);
      seq++;
      return;
    }
    if (ev.kind === 'edit') {
      if (ev.status === 'failed') return;
      const e: Edit = { seq: seq++, ...editPath(ev.path, sessionCwd), certainty: ev.status === 'ok' ? 'certain' : 'uncertain', via: ev.via, command: null };
      edits.push(e);
      span(e, ev, index);
      return;
    }
    // A shell command: one run per test segment, one uncertain edit per segment that may write.
    const { inner, dialect } = unwrap(ev.command, ev.dialect);
    const segs = segments(inner, dialect);
    // The call's own recorded directory (known or unreadable); else the shell's (Claude) or the session's.
    const callCwd: Cwd = ev.cwd !== undefined ? ev.cwd : persistent ? shellCwd : sessionCwd;
    let cwd: Cwd = callCwd;
    const runnerOf = (script: string): 'vitest' | 'jest' | 'pytest' | 'playwright' | null => {
      const dir = paths.locateDir(callCwd);
      const k = classifySegment(`npm run ${script}`, 'posix', dir === null ? null : (options.scripts?.(dir) ?? null));
      return k.kind === 'test' && k.framework !== 'unknown' ? k.framework : null;
    };
    const shape = callShape(inner, dialect, runnerOf);
    // Files the agent's tooling says this command changed are certain edits. Which
    // segment changed them is unknown, so they take the whole interval of the
    // call: from before its first segment to after its last one (and the call's
    // own span, when other calls ran at the same time). A run in the same call
    // overlaps them: neither before nor after.
    const first = seq;
    const changed: Edit[] = (ev.changedFiles ?? []).map((file) => ({ seq: first, ...editPath(file, callCwd), certainty: 'certain', via: 'shell', command: inner }));
    edits.push(...changed);
    if (changed.length) seq++;
    const before = runs.length;
    const editsBefore = edits.length;
    segs.forEach((seg, k) => {
      const dir = paths.locateDir(cwd);
      const kind = classifySegment(seg.text, dialect, dir === null ? null : (options.scripts?.(dir) ?? null));
      if (kind.kind === 'cd') {
        cwd = changeDir(cwd, kind.dir);
      } else if (kind.kind === 'test' || kind.kind === 'possible_test') {
        runs.push({
          id: `r${runs.length + 1}`,
          seq: seq++,
          command: seg.text,
          recognized: kind.kind === 'test',
          framework: kind.kind === 'test' ? kind.framework : 'unknown',
          selection: kind.kind === 'test' ? kind.selection : 'unknown',
          // Set below, from the closed grammar.
          cwd: null,
          ...(({ exit, unknown }) => ({ exit_code: exit, exit_unknown: unknown }))(segmentStatus(segs, k, ev.exit)),
          source: 'transcript',
          tree_sha: null,
          summary: null,
          tests: [],
          output_sha256: sha256(ev.output),
          output_truncated: ev.truncated,
        });
      } else if (kind.kind === 'mutating') {
        // Outside the closed list of non-executions: it may write files, and it may run the tests
        // (unless the call is a run in the grammar, whose other parts are only output filters).
        if (shape.kind !== 'run') runs.push(possibleRun(seq, seg.text, ev.output, ev.truncated));
        edits.push({ seq: seq++, path: null, certainty: 'uncertain', via: 'shell', command: seg.text });
      }
    });
    // To the call's last segment: every run in the call is inside the interval.
    if (seq - 1 > first) for (const e of changed) e.seq_end = seq - 1;
    // A run is placed only when the whole call is in the closed grammar
    // (src/transcript/grammar.ts): its directory and its positional paths in
    // the repository. Outside it, the run is unplaced: its result is unknown.
    const callRuns = runs.slice(before);
    for (const run of callRuns) {
      if (!run.recognized || shape.kind !== 'run' || callRuns.length !== 1 || (session.format === 'codex-exec-json' && ev.cwd === undefined)) {
        run.cwd = null;
        continue;
      }
      const at = shape.cd === null ? callCwd : changeDir(callCwd, shape.cd);
      const dir = paths.locateDir(at);
      const targets = shape.positionals.every((p) => paths.locate(p.split('::')[0]!, at) !== null);
      // Placed: repo-relative ('' for the root). Known but not placed: as written. Unknown: null.
      run.cwd = dir !== null && targets ? dir : dir === null && at.kind === 'known' ? at.path : null;
    }
    // Where the shell is after the call: a `cd` in the grammar that succeeded
    // moves it; anything outside the grammar that may move it leaves it unknown
    // until a `cd` to an absolute literal path.
    if (persistent && ev.cwd === undefined) {
      const failedCd = { kind: 'unknown', why: 'a cd that may have failed' } as const;
      if (shape.kind === 'cd') shellCwd = ev.exit === 0 ? changeDir(shellCwd, shape.dir) : failedCd;
      else if (shape.kind === 'run' && shape.cd !== null) shellCwd = ev.exit === 0 ? changeDir(callCwd, shape.cd) : failedCd;
      else if (shape.kind === 'other' && shape.movesShell) shellCwd = { kind: 'unknown', why: 'moved outside the grammar' };
    }
    for (const run of callRuns) span(run, ev, index);
    for (const e of [...changed, ...edits.slice(editsBefore)]) span(e, ev, index);
    // The output belongs to the whole command: summarise it only when one run produced it.
    if (runs.length - before === 1) {
      const run = runs[before]!;
      const parsed = parseSummary(ev.output, run.framework);
      if (parsed) {
        run.summary = parsed.summary;
        if (run.framework === 'unknown' && run.recognized) run.framework = parsed.framework;
      }
    }
    // Every call has a position of its own (a read-only one too).
    if (seq === first) seq++;
  });
  if (gaps.has(session.events.length)) gapSeq.set(session.events.length, seq++);
  for (const fix of fixups) fix();
  // Content the adapter could not read and could not place (a line that is not
  // JSON, an unknown record): it may be anywhere and may have changed any file.
  if (session.issues.some((i) => i.hides && !i.opaque)) {
    edits.push({ seq: 0, ...(seq > 1 ? { seq_end: seq - 1 } : {}), path: null, certainty: 'uncertain', via: 'opaque', command: 'content the adapter cannot read' });
  }

  const claims: Claim[] = [];
  for (const turn of session.turnEnds) {
    for (const c of extractClaims(turn.text)) {
      claims.push({
        id: `c${claims.length + 1}`,
        kind: c.kind,
        text: c.text,
        // Only the final turn's own message is the final claim.
        source: turn.final ? 'last_assistant_message' : 'turn_end',
        certainty: c.certainty,
        seq: claimSeq.get(turn.index) ?? 0,
      });
    }
  }

  return {
    schema: EVIDENCE_SCHEMA_ID,
    agent: { name: session.agent, version: session.version, session_id: session.sessionId },
    repo: { base: options.base ?? null, head: options.head ?? null },
    transcript: { format: session.format, complete: !session.issues.some((i) => i.hides), issues: session.issues.map((i) => i.text) },
    claims,
    runs,
    edits,
  };
}
