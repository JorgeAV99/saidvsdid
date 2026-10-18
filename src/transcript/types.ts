import type { TranscriptFormat } from '../evidence/schema.js';
import type { Cwd } from '../location.js';
import type { Dialect } from './shell.js';

/**
 * Something an adapter did not recognise. `hides`: it could hide a test run or
 * an edit (an unknown event type, an unknown tool, a line that is not JSON),
 * so the transcript is incomplete. Otherwise it is an unknown field on
 * something we understood, reported for the contract tests.
 */
export interface Issue {
  hides: boolean;
  /**
   * Recognised but opaque: an MCP tool or a subagent whose effects are not in
   * the transcript. Not an adapter gap (strict mode accepts it), but it still
   * hides what it did.
   */
  opaque?: boolean;
  text: string;
}

/**
 * When a tool call ran, in positions between events: gap g is the point
 * between events[g - 1] and events[g]. An event at index i without a span
 * happened at its own position. `start` < i: it may have begun before the
 * events in between (a rollout item completes inside a call opened earlier).
 * `end` > i + 1: its result came after the events in between (calls running
 * at the same time, a background command).
 */
export interface Span {
  start?: number;
  end?: number;
}

export type TranscriptEvent =
  | (Span & {
      kind: 'shell';
      command: string;
      dialect: Dialect;
      /**
       * The directory this call ran in, when the format records one per call
       * (a Codex rollout): known, or unknown when it cannot be read. Absent: the
       * format records none per call (the session's, or the shell's, applies).
       */
      cwd?: Cwd;
      /** Exit status of the whole command; null when unknown (no result, interrupted, backgrounded). */
      exit: number | null;
      output: string;
      truncated: boolean;
      /** Files the agent's own tooling reports this command changed (Claude Code's `bashEditDiff`). */
      changedFiles?: string[];
    })
  | (Span & {
      kind: 'edit';
      path: string;
      via: 'edit_tool' | 'patch';
      /** ok: the tool reported success. unknown: no result was seen, so it may or may not have happened. failed: it did not happen. */
      status: 'ok' | 'unknown' | 'failed';
    })
  /** `interim`: a message the agent marked as commentary on its way, not the end of its turn (Codex rollout `phase`). */
  | { kind: 'message'; text: string; messageId: string | null; interim?: boolean }
  /** Input from the user: it ends the agent's turn. */
  | { kind: 'prompt' }
  /** `ran: false`: a call that never ran (denied by the permission system); otherwise it may have done anything. */
  | (Span & { kind: 'opaque'; what: string; ran?: false });

/** `events` without the indexes in `drop`, with every span moved to the remaining positions. */
export function dropEvents(events: TranscriptEvent[], drop: ReadonlySet<number>): TranscriptEvent[] {
  if (drop.size === 0) return events;
  // A gap keeps its place relative to the events that remain.
  const gap = (g: number): number => g - [...drop].filter((i) => i < g).length;
  return events.flatMap((e, i) => {
    if (drop.has(i)) return [];
    if ((e.kind !== 'shell' && e.kind !== 'edit' && e.kind !== 'opaque') || (e.start === undefined && e.end === undefined)) return [e];
    return [{ ...e, ...(e.start !== undefined ? { start: gap(e.start) } : {}), ...(e.end !== undefined ? { end: gap(e.end) } : {}) }];
  });
}

export interface Session {
  agent: 'claude-code' | 'codex';
  format: TranscriptFormat;
  version: string;
  sessionId: string;
  /** Working directory of the session: known, unknown because the format does not record it (NOT_RECORDED), or unreadable. */
  cwd: Cwd;
  /** In transcript order. */
  events: TranscriptEvent[];
  /** Index in `events` of the last assistant message, and its text. */
  lastMessage: { index: number; text: string } | null;
  /**
   * The agent's final message of every turn (the last message before the next
   * user input, or before the end), in order. The last one is `lastMessage`.
   */
  turnEnds: { index: number; text: string; /** The final turn's own message (not an earlier turn's). */ final: boolean }[];
  issues: Issue[];
}

/** Records an unknown key per distinct (where, key) pair. */
export class IssueLog {
  readonly issues: Issue[] = [];
  private readonly seen = new Set<string>();

  add(hides: boolean, text: string): void {
    const key = `${hides}\0${text}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.issues.push({ hides, text });
  }

  /** Something recognised whose effects the transcript does not show. */
  opaque(text: string): void {
    const key = `opaque\0${text}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.issues.push({ hides: true, opaque: true, text });
  }

  keys(obj: unknown, allowed: ReadonlySet<string>, where: string): void {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      this.add(false, `${where}: expected an object, got ${Array.isArray(obj) ? 'array' : obj === null ? 'null' : typeof obj}`);
      return;
    }
    for (const k of Object.keys(obj)) if (!allowed.has(k)) this.add(false, `${where}: unknown field "${k}"`);
  }

  type(value: unknown, expected: 'string' | 'number' | 'boolean' | 'object', where: string, nullable = false): void {
    if (nullable && value === null) return;
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (actual !== expected) this.add(false, `${where}: expected ${expected}${nullable ? ' or null' : ''}, got ${actual}`);
  }
}

export const set = (...xs: string[]): ReadonlySet<string> => new Set(xs);
