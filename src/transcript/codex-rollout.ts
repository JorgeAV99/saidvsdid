// Codex's own session logs: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// (Codex CLI 0.158, Codex Desktop). One record per line:
// { timestamp, ordinal, type, payload, metadata? }.
//
// What ran is read from `event_msg` / `item_completed` items: CommandExecution
// (argv, cwd, status, exit_code, aggregated_output), FileChange (changes by
// path), AgentMessage. The model's own calls (`response_item`
// custom_tool_call `exec`, function_call `js`) are the programs it wrote; their
// effects appear as those items, so they are not read twice. Order is the order
// of lines in the file, never timestamps.
import { programName } from './shell.js';
import { messages } from './claude.js';
import { knownCwd, NOT_RECORDED, unknownCwd, type Cwd } from '../location.js';
import { IssueLog, set, type Session, type TranscriptEvent } from './types.js';
import { nameTable, ownRecord } from '../util/names.js';

type Rec = Record<string, unknown>;

const RECORD = set('timestamp', 'ordinal', 'type', 'payload', 'metadata');
/** Records without tool calls. */
const INERT_RECORDS = set('turn_context', 'compacted', 'token_usage_record', 'inter_agent_communication_metadata', 'world_state');
const SESSION_META = set(
  'session_id', 'id', 'timestamp', 'cwd', 'originator', 'cli_version', 'source', 'thread_source', 'model_provider',
  'base_instructions', 'history_mode', 'context_window', 'git', 'forked_from_id', 'parent_thread_id', 'agent_nickname',
  'agent_path', 'subagent_history_start_ordinal', 'multi_agent_version', 'creator_user_id', 'creator_account_id',
  'runtime_workspace_roots',
);
const PASSTHROUGH = 'internal_chat_message_metadata_passthrough';
const RESPONSE_ITEMS: Record<string, ReadonlySet<string>> = nameTable('RESPONSE_ITEMS', {
  message: set('type', 'id', 'role', 'content', PASSTHROUGH, 'phase'),
  reasoning: set('type', 'id', 'summary', 'encrypted_content', PASSTHROUGH, 'content'),
  agent_message: set('type', 'id', 'author', 'recipient', 'content', PASSTHROUGH),
  custom_tool_call: set('type', 'id', 'status', 'call_id', 'name', 'input', PASSTHROUGH),
  custom_tool_call_output: set('type', 'id', 'call_id', 'output', PASSTHROUGH),
  function_call: set('type', 'id', 'name', 'arguments', 'call_id', PASSTHROUGH, 'namespace'),
  function_call_output: set('type', 'id', 'call_id', 'output', PASSTHROUGH),
});
/** Tools the model calls whose effects surface as items (`exec`, `js`), or that only wait or talk. */
const CUSTOM_TOOLS = set('exec');
/**
 * The closed list of functions known not to edit files or run commands. Any
 * other call — `js` (it runs code), a subagent, an MCP tool, an unknown
 * function — is opaque from its call to its output, or to the end of the trace.
 */
const FUNCTIONS = set('wait', 'sleep', 'request_user_input_async', 'list_agents', 'wait_agent');
/** Functions that hand work to another agent, whose commands live in its own session file. */
const SUBAGENT_FUNCTIONS = set('spawn_agent', 'send_message', 'followup_task');
const EVENT_MSGS = set('item_completed', 'task_started', 'task_complete', 'thread_settings_applied', 'token_count');
const ITEM_COMPLETED = set('type', 'thread_id', 'turn_id', 'item', 'started_at_ms', 'completed_at_ms');
const ITEMS: Record<string, ReadonlySet<string>> = nameTable('ITEMS', {
  UserMessage: set('type', 'id', 'client_id', 'content'),
  Reasoning: set('type', 'id', 'summary_text', 'raw_content'),
  AgentMessage: set('type', 'id', 'content', 'phase', 'delivery', 'questions'),
  CommandExecution: set('type', 'id', 'process_id', 'command', 'cwd', 'parsed_cmd', 'source', 'status', 'stdout', 'stderr', 'aggregated_output', 'exit_code', 'duration', 'formatted_output'),
  McpToolCall: set('type', 'id', 'server', 'tool', 'arguments', 'status', 'result', 'duration', 'readOnlyHint', 'pluginId', 'connectorId', 'linkId', 'appName', 'actionName'),
  FileChange: set('type', 'id', 'changes', 'status', 'stdout', 'stderr'),
  ImageView: set('type', 'id', 'path'),
  ContextCompaction: set('type', 'id'),
  Extension: set('type', 'kind', 'id', 'query', 'action', 'results', 'durationMs'),
  SubAgentActivity: set('type', 'id', 'kind', 'agent_thread_id', 'agent_path'),
  CollabAgentToolCall: set('type', 'id', 'tool', 'status', 'sender_thread_id', 'receiver_thread_ids', 'receiver_agents', 'agents_states'),
});
const INERT_ITEMS = set('UserMessage', 'Reasoning', 'ImageView', 'ContextCompaction');
const EXTENSION_KINDS = set('web.search', 'clock.sleep');
const COMMAND_STATUS = set('completed', 'failed');
const CHANGE_TYPES = set('add', 'update', 'delete');
const CHANGE_FIELDS = set('type', 'unified_diff', 'content', 'move_path');
const MESSAGE_CONTENT = set('Text', 'text');

const obj = (v: unknown): Rec | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null);

/** Whether a transcript's first records are rollout records. */
export function isRollout(text: string): boolean {
  for (const line of text.split('\n').slice(0, 20)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Rec;
      if (r['type'] === 'session_meta' || ((r['type'] === 'response_item' || r['type'] === 'event_msg') && 'payload' in r)) return true;
    } catch {
      // not JSON: not a rollout line
    }
  }
  return false;
}

/** argv as Codex ran it → the command inside the launcher, and its dialect. */
function fromArgv(argv: string[]): { command: string; dialect: 'posix' | 'powershell' | 'cmd' } {
  const prog = programName(argv[0] ?? '');
  if ((prog === 'powershell' || prog === 'pwsh') && /^-(Command|c)$/i.test(argv[1] ?? '')) return { command: argv.slice(2).join(' '), dialect: 'powershell' };
  if (['bash', 'sh', 'zsh', 'dash'].includes(prog) && /^-[a-z]*c[a-z]*$/.test(argv[1] ?? '')) return { command: argv.slice(2).join(' '), dialect: 'posix' };
  if (prog === 'cmd' && /^\/[ck]$/i.test(argv[1] ?? '')) return { command: argv.slice(2).join(' '), dialect: 'cmd' };
  const quote = (w: string): string => (/^[\w./:=,@+-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`);
  return { command: argv.map(quote).join(' '), dialect: 'posix' };
}

/**
 * A working directory as Codex writes it: a path, or a `file:` URI (RFC 8089:
 * `file:///C:/x` is `C:/x`, `file:///home/x` is `/home/x`, percent-decoded).
 * A URI with another host, or one that does not decode, names no local
 * directory: null (unknown).
 */
export function localPath(s: string): string | null {
  if (!/^file:/i.test(s)) return s;
  const m = /^file:\/\/([^/]*)(\/.*)?$/i.exec(s);
  if (!m || (m[1] !== '' && m[1]!.toLowerCase() !== 'localhost')) return null;
  let p: string;
  try {
    p = decodeURIComponent(m[2] ?? '/');
  } catch {
    return null;
  }
  // `/C:/x` and the recorder's `/<REPO>/x` lose the slash before the drive or the marker.
  return /^\/(?:[A-Za-z]:|<[A-Z]+>)(?:\/|$)/.test(p) ? p.slice(1) : p;
}

/** A directory Codex wrote: known, or unknown when it is not a local path (another host, an undecodable URI). */
function cwdOf(s: string): Cwd {
  const p = localPath(s);
  return p === null ? unknownCwd('a directory Codex wrote that is not a local path') : knownCwd(p);
}

export function parseCodexRollout(text: string): Session {
  const log = new IssueLog();
  const events: TranscriptEvent[] = [];
  let sessionId = '';
  let version = '';
  let cwd: Cwd = unknownCwd(NOT_RECORDED);
  // Items are recorded when they complete. They started inside the model's call
  // that ran them: the earliest call still open (its position in `events`), or,
  // with none open (a command that outlived its call), anywhere in the turn.
  const openCalls = new Map<string, number>();
  let turnStart = 0;
  const span = (): { start?: number } => {
    const start = openCalls.size ? Math.min(...openCalls.values()) : turnStart;
    return start < events.length ? { start } : {};
  };
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      log.add(true, `line ${i + 1}: not JSON`);
      return;
    }
    const r = obj(raw);
    const type = r?.['type'];
    const payload = obj(r?.['payload']);
    if (!r || typeof type !== 'string' || !payload) {
      log.add(true, `line ${i + 1}: not a rollout record`);
      return;
    }
    log.keys(r, RECORD, 'rollout record');
    if (INERT_RECORDS.has(type)) return;
    if (type === 'session_meta') {
      log.keys(payload, SESSION_META, 'session_meta');
      // A file can hold the meta of a forked or parent thread too: the first is this session.
      if (!sessionId && typeof payload['id'] === 'string') {
        sessionId = payload['id'];
        version = typeof payload['cli_version'] === 'string' ? payload['cli_version'] : '';
        if (typeof payload['cwd'] === 'string') cwd = cwdOf(payload['cwd']);
      }
      return;
    }
    const ptype = String(payload['type']);
    if (type === 'response_item') {
      const fields = RESPONSE_ITEMS[ptype];
      if (!fields) {
        log.add(true, `unknown response_item "${ptype}": it could run tests or edit files`);
        return;
      }
      log.keys(payload, fields, `response_item ${ptype}`);
      const callId = typeof payload['call_id'] === 'string' ? payload['call_id'] : null;
      if (callId && (ptype === 'custom_tool_call' || ptype === 'function_call')) openCalls.set(callId, events.length);
      if (callId && (ptype === 'custom_tool_call_output' || ptype === 'function_call_output')) openCalls.delete(callId);
      const name = String(payload['name']);
      if (ptype === 'custom_tool_call' && !CUSTOM_TOOLS.has(name)) log.add(true, `unknown custom tool "${name}": it could run tests or edit files`);
      if (ptype === 'function_call' && SUBAGENT_FUNCTIONS.has(name)) log.opaque(`subagent (${name}): its commands are in another session file`);
      else if (ptype === 'function_call' && !FUNCTIONS.has(name)) log.opaque(`function "${name}": what it did is not in the transcript; it could run tests or edit files`);
      // Opaque calls: an event at the call. Its output is not its end (`spawn_agent` returns a
      // running agent's handle; no tool outside the closed lists is known to be synchronous).
      if (callId && ((ptype === 'custom_tool_call' && !CUSTOM_TOOLS.has(name)) || (ptype === 'function_call' && !FUNCTIONS.has(name)))) {
        events.push({ kind: 'opaque', what: `${ptype === 'function_call' ? 'function' : 'tool'} ${name}` });
      }
      return;
    }
    if (type !== 'event_msg') {
      log.add(true, `unknown record type "${type}"`);
      return;
    }
    if (!EVENT_MSGS.has(ptype)) {
      log.add(true, `unknown event_msg "${ptype}"`);
      return;
    }
    if (ptype !== 'item_completed') return;
    log.keys(payload, ITEM_COMPLETED, 'item_completed');
    const item = obj(payload['item']);
    const itype = String(item?.['type']);
    const fields = ITEMS[itype];
    if (!item || !fields) {
      log.add(true, `unknown item "${itype}": it could run tests or edit files`);
      events.push({ kind: 'opaque', what: `item ${itype}` });
      return;
    }
    log.keys(item, fields, `${itype} item`);
    if (itype === 'UserMessage') {
      events.push({ kind: 'prompt' }); // ends the agent's turn
      turnStart = events.length;
      return;
    }
    if (INERT_ITEMS.has(itype)) return;
    if (itype === 'AgentMessage') {
      const content = Array.isArray(item['content']) ? item['content'] : [];
      const textParts: string[] = [];
      for (const raw of content) {
        const c = obj(raw);
        // Codex writes `Text` here (and `output_text` in the matching response_item).
        if (c && MESSAGE_CONTENT.has(String(c['type'])) && typeof c['text'] === 'string') textParts.push(c['text']);
        else log.add(false, `AgentMessage: unknown content type ${JSON.stringify(c?.['type'])}`);
      }
      // `commentary`: what the agent says on its way, not the end of its turn (`final_answer`).
      events.push({ kind: 'message', text: textParts.join('\n\n'), messageId: null, ...(item['phase'] === 'commentary' ? { interim: true } : {}) });
    } else if (itype === 'CommandExecution') {
      const argv = Array.isArray(item['command']) ? item['command'].filter((w): w is string => typeof w === 'string') : [];
      if (!argv.length) log.add(true, 'CommandExecution without a command');
      const status = String(item['status']);
      if (!COMMAND_STATUS.has(status)) log.add(false, `CommandExecution: unknown status "${status}"`);
      log.type(item['exit_code'], 'number', 'CommandExecution.exit_code', true);
      const output = typeof item['aggregated_output'] === 'string' ? item['aggregated_output'] : '';
      const { command, dialect } = fromArgv(argv);
      events.push({
        ...span(),
        kind: 'shell',
        command,
        dialect,
        // A rollout records each command's directory: one it did not record (absent, null) is unknown, never the session's.
        cwd: typeof item['cwd'] === 'string' ? cwdOf(item['cwd']) : unknownCwd('the rollout recorded no directory for this command'),
        exit: COMMAND_STATUS.has(status) && typeof item['exit_code'] === 'number' ? item['exit_code'] : null,
        output,
        truncated: /truncated/i.test(output),
      });
    } else if (itype === 'FileChange') {
      const changes = obj(item['changes']);
      if (!changes) log.add(true, 'FileChange: changes is not an object');
      const status = String(item['status']);
      if (status !== 'completed') log.add(false, `FileChange: unknown status "${status}"`);
      const started = span();
      for (const [path, c] of Object.entries(changes ?? ownRecord({}))) {
        const change = obj(c);
        log.keys(change, CHANGE_FIELDS, 'FileChange change');
        if (!CHANGE_TYPES.has(String(change?.['type']))) log.add(false, `FileChange: unknown change type "${String(change?.['type'])}"`);
        const ok = status === 'completed' ? 'ok' : 'unknown';
        events.push({ ...started, kind: 'edit', path, via: 'patch', status: ok });
        const moved = change?.['move_path'];
        if (typeof moved === 'string') events.push({ ...started, kind: 'edit', path: moved, via: 'patch', status: ok });
      }
    } else if (itype === 'McpToolCall') {
      // Opaque whatever it declares: readOnlyHint is the server's own word, not a fact the harness recorded.
      log.opaque(`MCP tool "${String(item['server'])}.${String(item['tool'])}": what it did is not in the transcript; it could run tests or edit files`);
      events.push({ kind: 'opaque', what: 'mcp tool' });
    } else if (itype === 'Extension') {
      if (!EXTENSION_KINDS.has(String(item['kind']))) log.add(true, `unknown Extension kind "${String(item['kind'])}": it could run tests or edit files`);
    } else {
      // SubAgentActivity, CollabAgentToolCall
      log.opaque(`subagent (${itype}): its commands are in another session file`);
      events.push({ kind: 'opaque', what: itype });
    }
  });
  // Every opaque call or item may act until the end of the trace.
  events.forEach((e, at) => {
    if (e.kind === 'opaque' && e.ran !== false && events.length > at + 1) events[at] = { ...e, end: events.length };
  });
  return { agent: 'codex', format: 'codex-rollout', version, sessionId, cwd, events, ...messages(events), issues: log.issues };
}
