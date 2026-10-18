// Claude Code transcripts: the interactive JSONL under ~/.claude/projects and
// the headless `claude -p --output-format stream-json --verbose` stream.
//
// - tool_use and tool_result are paired by tool_use_id;
// - records are de-duplicated by uuid, keeping the last copy at the position
//   of the first (a resumed session may write history again);
// - `toolUseResult` (JSONL) / `tool_use_result` (stream) may be an object or a
//   string (the error text);
// - order is the order of records in the file, never their timestamps.
import { knownCwd, NOT_RECORDED, unknownCwd } from '../location.js';
import { dropEvents, IssueLog, set, type Session, type TranscriptEvent } from './types.js';
import { nameTable, ownRecord } from '../util/names.js';

type Rec = Record<string, unknown>;

const COMMON_RECORD = [
  'type', 'uuid', 'parentUuid', 'isSidechain', 'message', 'timestamp', 'userType', 'entrypoint', 'cwd', 'sessionId',
  'version', 'gitBranch', 'isMeta', 'agentId', 'slug', 'logicalParentUuid', 'isVisibleInTranscriptOnly', 'isCompactSummary',
  // stream-json
  'session_id', 'parent_tool_use_id',
];
const ASSISTANT_RECORD = set(
  ...COMMON_RECORD, 'requestId', 'wireToolInputs', 'apiBlockIndex', 'advisorModel', 'effort', 'perTurnEffort',
  'isApiErrorMessage', 'error', 'request_id', 'wire_tool_inputs',
  // desktop app, 2.1.281+
  'serverClassifierRequest', 'wireIngestContext', 'attributionMcpServer', 'attributionMcpTool',
);
const USER_RECORD = set(
  ...COMMON_RECORD, 'promptId', 'permissionMode', 'promptSource', 'turnOrigin', 'toolUseResult', 'sourceToolAssistantUUID',
  'thinkingMetadata', 'todos', 'imagePasteIds', 'tool_use_result',
  // desktop app, 2.1.281+
  'origin', 'turnPosition', 'serverClassifierContext', 'queueSkipAttachments',
  // 2.1.284: the permission system denied the tool call; it never ran
  'toolDenialKind',
);
const ASSISTANT_MESSAGE = set(
  'model', 'id', 'type', 'role', 'content', 'container', 'stop_reason', 'stop_sequence', 'stop_details', 'usage',
  'input_transformations', 'diagnostics', 'context_management',
);
const USER_MESSAGE = set('role', 'content');
/** Records that carry no tool calls. */
const IGNORED_RECORDS = set(
  'system', 'result', 'rate_limit_event', 'attachment', 'queue-operation', 'atis-latch', 'last-prompt', 'cost-state',
  'summary', 'file-history-snapshot', 'progress', 'custom-title',
  // Metadata of the desktop app (2.1.281+): session name, permission mode,
  // linked pull request, file checkpoint backups. None carries a tool call.
  'agent-name', 'mode', 'pr-link', 'file-history-delta',
);
const SYSTEM_SUBTYPES = set(
  'init', 'task_started', 'task_notification', 'thinking_tokens', 'compact_boundary', 'api_retry', 'informational', 'local_command', 'stop_hook_summary',
  // 2.1.283, recorded sessions: hooks (stream-json with --include-hook-events), background tasks, permissions, commands.
  'hook_started', 'hook_response', 'hook_progress', 'background_tasks_changed', 'task_updated', 'permission_denied', 'commands_changed',
);

const TOOL_USE = set('type', 'id', 'name', 'input', 'caller');
const TOOL_RESULT = set('type', 'tool_use_id', 'content', 'is_error');
const RESULT_ITEM_TYPES = set('text', 'image', 'tool_reference');

const SHELL_TOOLS: Record<string, { dialect: 'posix' | 'powershell'; input: ReadonlySet<string> }> = nameTable('SHELL_TOOLS', {
  Bash: { dialect: 'posix', input: set('command', 'description', 'timeout', 'run_in_background', 'dangerouslyDisableSandbox') },
  PowerShell: { dialect: 'powershell', input: set('command', 'description', 'timeout', 'run_in_background', 'dangerouslyDisableSandbox') },
});
const SHELL_RESULT = set(
  'stdout', 'stderr', 'interrupted', 'isImage', 'noOutputExpected', 'returnCodeInterpretation', 'backgroundTaskId',
  // 2.1.281+: files the command changed, git push/PR it made, output saved to a file (the result holds a preview)
  'bashEditDiff', 'gitOperation', 'persistedOutputPath', 'persistedOutputSize',
);
const BASH_EDIT_DIFF = set('files', 'moreFiles', 'changedFiles', 'unavailable');
const EDIT_TOOLS: Record<string, { pathKey: string; input: ReadonlySet<string> }> = nameTable('EDIT_TOOLS', {
  Edit: { pathKey: 'file_path', input: set('file_path', 'old_string', 'new_string', 'replace_all') },
  Write: { pathKey: 'file_path', input: set('file_path', 'content') },
  MultiEdit: { pathKey: 'file_path', input: set('file_path', 'edits') },
  NotebookEdit: { pathKey: 'notebook_path', input: set('notebook_path', 'cell_id', 'new_source', 'cell_type', 'edit_mode') },
});
/** Tools that neither run commands nor write files. */
const INERT_TOOLS = set(
  'Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'NotebookRead', 'ToolSearch', 'AskUserQuestion',
  'ExitPlanMode', 'EnterPlanMode', 'BashOutput', 'TaskOutput', 'KillShell', 'KillBash', 'TaskStop', 'Skill',
  'ListMcpResourcesTool', 'ReadMcpResourceTool',
);
const SUBAGENT_TOOLS = set('Task', 'Agent');
/** MCP tools of the Claude desktop app that neither run commands nor write files: a chapter marker, reading and configuring the PR monitor. */
const INERT_MCP_TOOLS = set('mcp__ccd_session__mark_chapter', 'mcp__ccd_pr__get_status', 'mcp__ccd_pr__set_monitor');

const obj = (v: unknown): Rec | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null);

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => (obj(c)?.['type'] === 'text' && typeof obj(c)?.['text'] === 'string' ? (obj(c)!['text'] as string) : '')).join('\n');
}

export function parseClaude(text: string): Session {
  const log = new IssueLog();
  // De-duplicate by uuid: last copy wins, first position is kept.
  const records: Rec[] = [];
  const at = new Map<string, number>();
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      log.add(true, `line ${i + 1}: not JSON`);
      return;
    }
    const r = obj(rec);
    if (!r) {
      log.add(true, `line ${i + 1}: not a JSON object`);
      return;
    }
    const uuid = typeof r['uuid'] === 'string' ? r['uuid'] : null;
    if (uuid !== null && at.has(uuid)) records[at.get(uuid)!] = r;
    else {
      if (uuid !== null) at.set(uuid, records.length);
      records.push(r);
    }
  });

  const stream = records.some((r) => r['type'] === 'system' && r['subtype'] === 'init') || records.some((r) => 'session_id' in r);
  const init = records.find((r) => r['type'] === 'system' && r['subtype'] === 'init');
  const firstWith = (key: string): string | null => {
    const r = records.find((x) => typeof x[key] === 'string');
    return r ? (r[key] as string) : null;
  };
  const version = (init?.['claude_code_version'] as string | undefined) ?? firstWith('version') ?? '';
  const sessionId = (init?.['session_id'] as string | undefined) ?? firstWith('sessionId') ?? firstWith('session_id') ?? '';
  // The session's directory: the init record's, else the first record that carries one.
  const recordedCwd = typeof init?.['cwd'] === 'string' ? (init['cwd'] as string) : firstWith('cwd');

  const events: TranscriptEvent[] = [];
  const pending = new Map<string, number>(); // tool_use_id → index in events
  const subagents = new Map<string, number>();
  const withChildren = new Set<string>();
  const sidechain = records.some((r) => r['isSidechain'] === true);

  for (const r of records) {
    const type = r['type'];
    const parent = r['parent_tool_use_id'];
    if (typeof parent === 'string') withChildren.add(parent);
    if (type === 'assistant' || type === 'user') {
      log.keys(r, type === 'assistant' ? ASSISTANT_RECORD : USER_RECORD, `${type} record`);
      const message = obj(r['message']);
      if (!message) {
        log.add(true, `${type} record without a message object`);
        continue;
      }
      log.keys(message, type === 'assistant' ? ASSISTANT_MESSAGE : USER_MESSAGE, `${type} message`);
      const content = message['content'];
      // Input from the user ends the agent's turn; system-injected text (meta, compaction summaries) does not.
      const fromUser = type === 'user' && r['isMeta'] !== true && r['isCompactSummary'] !== true && r['isVisibleInTranscriptOnly'] !== true;
      if (typeof content === 'string') {
        if (type === 'assistant') events.push({ kind: 'message', text: content, messageId: (message['id'] as string | undefined) ?? null });
        else if (fromUser) events.push({ kind: 'prompt' });
        continue;
      }
      if (fromUser && Array.isArray(content) && content.some((b) => obj(b)?.['type'] === 'text') && !content.some((b) => obj(b)?.['type'] === 'tool_result')) {
        events.push({ kind: 'prompt' });
      }
      if (!Array.isArray(content)) {
        log.add(true, `${type} message: content is neither a string nor an array`);
        continue;
      }
      for (const raw of content) {
        const b = obj(raw);
        const btype = b?.['type'];
        if (!b || typeof btype !== 'string') {
          log.add(true, `${type} message: content block without a type`);
          continue;
        }
        if (type === 'assistant') assistantBlock(b, btype, message, events, pending, subagents, log);
        else userBlock(b, btype, r, events, pending, log);
      }
    } else if (typeof type === 'string' && IGNORED_RECORDS.has(type)) {
      if (type === 'system' && typeof r['subtype'] === 'string' && !SYSTEM_SUBTYPES.has(r['subtype'])) {
        log.add(false, `system record: unknown subtype "${r['subtype']}"`);
      }
    } else {
      log.add(true, `unknown record type ${JSON.stringify(type)}`);
    }
  }

  // A call with no result, or a background command, may still be running at the end.
  for (const [key, index] of pending) {
    if (key.endsWith('\0background')) continue;
    const e = events[index]!;
    if ((e.kind === 'shell' || e.kind === 'edit' || e.kind === 'opaque') && events.length > index + 1) events[index] = { ...e, end: events.length };
  }
  // A subagent may run tests or edit files until its definitive completion, which
  // no format records: it lasts to the end of the trace. Its own events in this
  // transcript (a child record, a sidechain) show part of what it did, never that
  // it is done.
  for (const [id] of subagents) {
    log.opaque(withChildren.has(id) || sidechain ? `subagent call ${id}: some of its tool calls are in this transcript; it may act until the end` : `subagent call ${id}: its tool calls are not in this transcript`);
  }
  const resolved = dropEvents(events, new Set());
  return {
    agent: 'claude-code',
    format: stream ? 'claude-stream-json' : 'claude-jsonl',
    version,
    sessionId,
    cwd: recordedCwd === null ? unknownCwd(NOT_RECORDED) : knownCwd(recordedCwd),
    events: resolved,
    ...messages(resolved),
    issues: log.issues,
  };
}

function assistantBlock(
  b: Rec,
  btype: string,
  message: Rec,
  events: TranscriptEvent[],
  pending: Map<string, number>,
  subagents: Map<string, number>,
  log: IssueLog,
): void {
  if (btype === 'text') {
    log.type(b['text'], 'string', 'text block');
    events.push({ kind: 'message', text: String(b['text'] ?? ''), messageId: (message['id'] as string | undefined) ?? null });
    return;
  }
  if (btype === 'thinking' || btype === 'redacted_thinking' || btype === 'server_tool_use' || btype === 'web_search_tool_result') return;
  if (btype !== 'tool_use') {
    log.add(true, `assistant message: unknown content block "${btype}"`);
    return;
  }
  log.keys(b, TOOL_USE, 'tool_use');
  const id = String(b['id'] ?? '');
  const name = String(b['name'] ?? '');
  const input = obj(b['input']) ?? ownRecord({});
  const shell = SHELL_TOOLS[name];
  const edit = EDIT_TOOLS[name];
  if (shell) {
    log.keys(input, shell.input, `${name} input`);
    log.type(input['command'], 'string', `${name} input.command`);
    pending.set(id, events.length);
    events.push({
      kind: 'shell',
      command: String(input['command'] ?? ''),
      dialect: shell.dialect,
      exit: null,
      output: '',
      truncated: false,
    });
    if (input['run_in_background'] === true) pending.set(`${id}\0background`, events.length - 1);
  } else if (edit) {
    log.keys(input, edit.input, `${name} input`);
    log.type(input[edit.pathKey], 'string', `${name} input.${edit.pathKey}`);
    pending.set(id, events.length);
    events.push({ kind: 'edit', path: String(input[edit.pathKey] ?? ''), via: 'edit_tool', status: 'unknown' });
  } else if (SUBAGENT_TOOLS.has(name)) {
    // Opaque from its call to its result (or the end): it may act all along.
    subagents.set(id, events.length);
    pending.set(id, events.length);
    events.push({ kind: 'opaque', what: `subagent ${id}` });
  } else if (name.startsWith('mcp__') && !INERT_MCP_TOOLS.has(name)) {
    log.opaque(`MCP tool "${name}": what it did is not in the transcript; it could run tests or edit files`);
    pending.set(id, events.length);
    events.push({ kind: 'opaque', what: `tool ${name}` });
  } else if (!INERT_TOOLS.has(name) && !INERT_MCP_TOOLS.has(name)) {
    // Not in the closed list of tools that do not edit: opaque.
    log.add(true, `unknown tool "${name}": it could run tests or edit files`);
    pending.set(id, events.length);
    events.push({ kind: 'opaque', what: `tool ${name}` });
  }
}

function userBlock(b: Rec, btype: string, record: Rec, events: TranscriptEvent[], pending: Map<string, number>, log: IssueLog): void {
  if (btype === 'text' || btype === 'image' || btype === 'document') return;
  if (btype !== 'tool_result') {
    log.add(true, `user message: unknown content block "${btype}"`);
    return;
  }
  log.keys(b, TOOL_RESULT, 'tool_result');
  const content = b['content'];
  if (Array.isArray(content)) {
    for (const item of content) {
      const t = obj(item)?.['type'];
      if (typeof t !== 'string' || !RESULT_ITEM_TYPES.has(t)) log.add(false, `tool_result content: unknown item type ${JSON.stringify(t)}`);
    }
  } else if (content !== undefined && typeof content !== 'string') {
    log.add(false, `tool_result content: expected string or array, got ${typeof content}`);
  }
  const id = String(b['tool_use_id'] ?? '');
  const index = pending.get(id);
  if (index === undefined) return; // result of an inert tool
  const event = events[index]!;
  const isError = b['is_error'] === true;
  const text = resultText(content);
  // Denied by the permission system: the call never ran (no run, no edit).
  if (typeof record['toolDenialKind'] === 'string') {
    pending.delete(id);
    events[index] = event.kind === 'edit' ? { ...event, status: 'failed' } : { kind: 'opaque', what: 'denied tool call', ran: false };
    return;
  }
  // An opaque tool's result is not its end (an MCP server or a subagent may go on
  // working, a result may be a handle): it stays open to the end of the trace.
  if (event.kind === 'opaque') return;
  pending.delete(id);
  // The result arrives here: other calls made in between ran at the same time.
  const end = events.length > index + 1 ? { end: events.length } : {};
  if (event.kind === 'edit') {
    events[index] = { ...event, status: isError ? 'failed' : 'ok', ...end };
    return;
  }
  if (event.kind !== 'shell') return;
  const tur = record['toolUseResult'] ?? record['tool_use_result'];
  const turObj = obj(tur);
  if (turObj) log.keys(turObj, SHELL_RESULT, 'shell toolUseResult');
  else if (tur !== undefined && typeof tur !== 'string') log.add(false, `shell toolUseResult: expected object or string, got ${typeof tur}`);
  let exit: number | null;
  if (isError) {
    const m = /^(?:Error: )?Exit code (-?\d+)\b/.exec(text);
    exit = m ? Number(m[1]) : null;
  } else {
    exit = 0;
  }
  // Not a plain completion: the status says nothing about the command.
  if (pending.has(`${id}\0background`) || turObj?.['interrupted'] === true || turObj?.['backgroundTaskId'] !== undefined || turObj?.['returnCodeInterpretation'] !== undefined) {
    exit = null;
  }
  if (!isError && tur !== undefined && !turObj) exit = null;
  // Large output is saved to a file and the result holds a preview.
  const truncated = /truncated/i.test(text) || turObj?.['persistedOutputPath'] !== undefined;
  events[index] = { ...event, exit, output: text, truncated, ...end, ...changedFiles(turObj?.['bashEditDiff'], log) };
  // A background command keeps running after its result: its end is unknown.
  if (pending.has(`${id}\0background`) || turObj?.['backgroundTaskId'] !== undefined) pending.set(`${id}\0open`, index);
}

/** Files Claude Code reports a Bash command changed (`bashEditDiff.changedFiles`). */
function changedFiles(diff: unknown, log: IssueLog): { changedFiles?: string[] } {
  if (diff === undefined) return {};
  const d = obj(diff);
  if (!d) {
    log.add(false, `bashEditDiff: expected an object, got ${typeof diff}`);
    return {};
  }
  log.keys(d, BASH_EDIT_DIFF, 'bashEditDiff');
  const files = Array.isArray(d['changedFiles']) ? d['changedFiles'].filter((f): f is string => typeof f === 'string') : [];
  return files.length ? { changedFiles: files } : {};
}

/** Text of the last assistant message that has text: its text blocks, joined. */
export function lastMessage(events: TranscriptEvent[], from = 0, to = events.length): { index: number; text: string } | null {
  for (let i = to - 1; i >= from; i--) {
    const e = events[i]!;
    if (e.kind !== 'message' || e.interim || e.text.trim() === '') continue;
    if (e.messageId === null) return { index: i, text: e.text };
    const parts = events.slice(from, to).filter((x): x is Extract<TranscriptEvent, { kind: 'message' }> => x.kind === 'message' && x.messageId === e.messageId);
    return { index: i, text: parts.map((p) => p.text).join('\n\n') };
  }
  return null;
}

/**
 * The last message of every turn: the stretches between user prompts. `final`
 * marks the final turn's own message; a final turn with no text has none, and
 * an earlier turn's message never stands in for it.
 */
export function turnEnds(events: TranscriptEvent[]): { index: number; text: string; final: boolean }[] {
  const out: { index: number; text: string; final: boolean }[] = [];
  let start = 0;
  const close = (end: number, final: boolean): void => {
    const m = lastMessage(events, start, end);
    if (m) out.push({ ...m, final });
  };
  events.forEach((e, i) => {
    if (e.kind !== 'prompt') return;
    close(i, false);
    start = i + 1;
  });
  close(events.length, true);
  return out;
}

/** lastMessage and turnEnds of a session's events. */
export function messages(events: TranscriptEvent[]): { lastMessage: { index: number; text: string } | null; turnEnds: { index: number; text: string; final: boolean }[] } {
  const ends = turnEnds(events);
  const last = ends[ends.length - 1];
  return { lastMessage: last ? { index: last.index, text: last.text } : null, turnEnds: ends };
}
