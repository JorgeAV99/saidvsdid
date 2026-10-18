// Aggregate TG006 statistics over an agent's local session history
// (bench/scan-history.mjs). Read-only. The result holds counts and session ids
// only: no message text, command, path or claim ever leaves this function.
//
// Counted per END OF TURN (the agent's last message before the next user
// input), each judged with the evidence accumulated up to it: the granularity
// of a Stop hook.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceFromSession } from './evidence/from-transcript.js';
import { judgeTurns, type WarnReason } from './rules/TG006.js';
import { detectAgent, parseTranscript } from './transcript/index.js';

export interface ScanRoots {
  /** ~/.claude/projects: one directory per project, one <session>.jsonl per session. */
  claude?: string | null;
  /** ~/.codex/sessions: JSONL files at any depth. */
  codex?: string | null;
}

export interface ScanResult {
  files: { claude: number; codex: number };
  /** Files that are not a format the adapters read, and files that could not be read. */
  unsupported: number;
  unreadable: number;
  /**
   * Transcripts with something the adapter does not recognise (a record, item,
   * tool or field): a gap in the adapter. The quality metric.
   */
  unrecognised: number;
  /** Transcripts the adapter reads fully but that call MCP tools or subagents whose effects it cannot see. */
  opaque: number;
  /** Ends of turn read. */
  turns: number;
  /** Ends of turn with each kind of claim. */
  claims: { suite_certain: number; suite_possible: number; suite_disclosed: number; tests_added: number; regression_test_added: number };
  /** TG006 per end of turn that claims the suite passes. */
  tg006: {
    /** WARN: something for the reviewer (TG006 never FAILs). */
    warn: number;
    /** INFO: consistent with what is visible, not verified, or disclosed. */
    info: number;
    /** Turns per reason (a turn with several reasons counts once for each). */
    warnReasons: Partial<Record<WarnReason, number>>;
    /** Session ids with at least one turn of that outcome, sorted. */
    sessions: { warn: string[]; info: string[] };
  };
}

function jsonlFiles(dir: string, depth: number): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries.sort()) {
    const p = join(dir, e);
    let isDir = false;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      if (depth > 0) out.push(...jsonlFiles(p, depth - 1));
    } else if (e.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

export function scanHistory(roots: ScanRoots): ScanResult {
  const result: ScanResult = {
    files: { claude: 0, codex: 0 },
    unsupported: 0,
    unreadable: 0,
    unrecognised: 0,
    opaque: 0,
    turns: 0,
    claims: { suite_certain: 0, suite_possible: 0, suite_disclosed: 0, tests_added: 0, regression_test_added: 0 },
    tg006: { warn: 0, info: 0, warnReasons: {}, sessions: { warn: [], info: [] } },
  };
  // Claude: <projects>/<project>/<session>.jsonl; subagent files live one level deeper and are not sessions.
  const files: [string, 'claude' | 'codex'][] = [
    ...(roots.claude ? jsonlFiles(roots.claude, 1).map((f) => [f, 'claude'] as [string, 'claude']) : []),
    ...(roots.codex ? jsonlFiles(roots.codex, 8).map((f) => [f, 'codex'] as [string, 'codex']) : []),
  ];
  for (const [file, source] of files) {
    result.files[source]++;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      result.unreadable++;
      continue;
    }
    const agent = detectAgent(text);
    if (agent === null) {
      result.unsupported++;
      continue;
    }
    let evidence;
    let session;
    try {
      session = parseTranscript(text, agent);
      // No repository under review: each session is judged against its own
      // working directory, the only root it records (none: nothing is placed).
      evidence = evidenceFromSession(session, { roots: session.cwd.kind === 'known' ? [session.cwd.path] : [] });
    } catch {
      result.unreadable++;
      continue;
    }
    if (session.issues.some((i) => !i.opaque)) result.unrecognised++;
    else if (session.issues.some((i) => i.opaque)) result.opaque++;
    result.turns += session.turnEnds.length;
    // Claims per end of turn: one position per turn.
    const byTurn = new Map<number, typeof evidence.claims>();
    for (const c of evidence.claims) byTurn.set(c.seq, [...(byTurn.get(c.seq) ?? []), c]);
    for (const claims of byTurn.values()) {
      const suite = claims.find((c) => c.kind === 'suite_passed');
      if (suite?.certainty === 'certain') result.claims.suite_certain++;
      if (suite?.certainty === 'possible') result.claims.suite_possible++;
      if (suite?.certainty === 'disclosed') result.claims.suite_disclosed++;
      if (claims.some((c) => c.kind === 'tests_added')) result.claims.tests_added++;
      if (claims.some((c) => c.kind === 'regression_test_added')) result.claims.regression_test_added++;
    }
    const id = evidence.agent.session_id || file.replace(/^.*[\\/]/, '').replace(/\.jsonl$/, '');
    for (const j of judgeTurns(evidence)) {
      const bucket = j.severity;
      result.tg006[bucket]++;
      result.tg006.sessions[bucket].push(id);
      if (bucket === 'warn') for (const why of j.warnReasons) result.tg006.warnReasons[why] = (result.tg006.warnReasons[why] ?? 0) + 1;
    }
  }
  // A session with several turns of one outcome is listed once.
  for (const k of ['warn', 'info'] as const) result.tg006.sessions[k] = [...new Set(result.tg006.sessions[k])].sort();
  return result;
}

export function renderScan(r: ScanResult): string {
  const { warn, info } = r.tg006;
  const warnWhy = Object.entries(r.tg006.warnReasons).map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join(' · ') || '-';
  const lines = [
    'saidvsdid scan-history — read-only; counts and session ids only, no session content',
    `files: ${r.files.claude + r.files.codex} (claude ${r.files.claude}, codex ${r.files.codex}); unsupported format ${r.unsupported}; unreadable ${r.unreadable}`,
    `transcripts with content the adapter does not recognise (adapter gaps): ${r.unrecognised}`,
    `transcripts that call MCP tools or subagents it cannot see into (TG006 at most WARN): ${r.opaque}`,
    `ends of turn: ${r.turns}; with a suite claim: certain ${r.claims.suite_certain} · possible ${r.claims.suite_possible} · disclosed ${r.claims.suite_disclosed}; tests_added ${r.claims.tests_added} · regression_test_added ${r.claims.regression_test_added}`,
    `TG006 per end of turn (warnings for the reviewer, never FAIL or PASS): WARN ${warn} · INFO ${info}`,
    `  WARN because: ${warnWhy}`,
    `  WARN sessions: ${r.tg006.sessions.warn.join(' ') || '-'}`,
  ];
  return lines.join('\n') + '\n';
}
