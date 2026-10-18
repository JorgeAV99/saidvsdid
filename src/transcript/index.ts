import { parseClaude } from './claude.js';
import { parseCodex } from './codex.js';
import { isRollout, parseCodexRollout } from './codex-rollout.js';
import type { Session } from './types.js';

export type { Issue, Session, TranscriptEvent } from './types.js';

export type AgentOption = 'auto' | 'claude' | 'codex';

export class TranscriptError extends Error {
  override name = 'TranscriptError';
}

const CODEX_EVENTS = new Set([
  'thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed',
  // rollout records (~/.codex/sessions)
  'session_meta', 'response_item', 'event_msg', 'turn_context',
]);
const CLAUDE_RECORDS = new Set(['user', 'assistant', 'system', 'result', 'summary', 'queue-operation', 'attachment', 'file-history-snapshot']);

/** Which agent wrote a transcript, from the types of its first records. */
export function detectAgent(text: string): 'claude' | 'codex' | null {
  let seen = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (++seen > 50) break;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const type = (rec as { type?: unknown } | null)?.type;
    if (typeof type !== 'string') continue;
    if (CODEX_EVENTS.has(type)) return 'codex';
    if (CLAUDE_RECORDS.has(type)) return 'claude';
  }
  return null;
}

export function parseTranscript(text: string, agent: AgentOption = 'auto', options: { version?: string } = {}): Session {
  const which = agent === 'auto' ? detectAgent(text) : agent;
  if (which === null) throw new TranscriptError('not a Claude Code or Codex transcript (use --agent claude|codex to force one)');
  if (which === 'claude') return parseClaude(text);
  // Codex: its own session log (~/.codex/sessions) or `codex exec --json`.
  return isRollout(text) ? parseCodexRollout(text) : parseCodex(text, options.version ?? '');
}

/** Contract mode: anything the adapter did not recognise is an error (opaque but recognised tools are not). */
export function assertKnown(session: Session): void {
  const unknown = session.issues.filter((i) => !i.opaque);
  if (unknown.length > 0) {
    throw new TranscriptError(`transcript has unrecognised content (${session.agent} ${session.version || 'unknown version'}):\n  ${unknown.map((i) => i.text).join('\n  ')}`);
  }
}
