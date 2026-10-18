// Codex `exec --json` streams: thread/turn events and items. An item keeps the
// position of its first appearance (item.started) and the data of its last
// (item.completed). Commands arrive wrapped in the launcher Codex used
// (`bash -lc '…'`, `powershell.exe -Command '…'`); the wrapper is removed when
// the command is analysed.
import { NOT_RECORDED, unknownCwd } from '../location.js';
import { IssueLog, set, type Session, type TranscriptEvent } from './types.js';
import { messages } from './claude.js';
import { nameTable } from '../util/names.js';

type Rec = Record<string, unknown>;

const EVENT_TYPES = set('thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error');
const ITEM_FIELDS: Record<string, ReadonlySet<string>> = nameTable('ITEM_FIELDS', {
  agent_message: set('id', 'type', 'text'),
  command_execution: set('id', 'type', 'command', 'aggregated_output', 'exit_code', 'status'),
  file_change: set('id', 'type', 'changes', 'status'),
  reasoning: set('id', 'type', 'text'),
  todo_list: set('id', 'type', 'items'),
  web_search: set('id', 'type', 'query'),
  error: set('id', 'type', 'message'),
  mcp_tool_call: set('id', 'type', 'server', 'tool', 'arguments', 'result', 'error', 'status'),
});
const INERT_ITEMS = set('reasoning', 'todo_list', 'web_search', 'error');
const COMMAND_STATUS = set('in_progress', 'completed', 'failed', 'declined');
const CHANGE_STATUS = set('in_progress', 'completed', 'failed');
const CHANGE_FIELDS = set('path', 'kind');
const CHANGE_KINDS = set('add', 'delete', 'update');
export const CODEX_TRUNCATED = '...(truncated)';

const obj = (v: unknown): Rec | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null);

export function parseCodex(text: string, version = ''): Session {
  const log = new IssueLog();
  let sessionId = '';
  // Items in order of first appearance, each with its latest copy, and the
  // lines where it first and last appeared (its start and its end).
  const order: string[] = [];
  const latest = new Map<string, Rec>();
  const firstLine = new Map<string, number>();
  const lastLine = new Map<string, number>();
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      log.add(true, `line ${i + 1}: not JSON`);
      return;
    }
    const ev = obj(raw);
    const type = ev?.['type'];
    if (!ev || typeof type !== 'string' || !EVENT_TYPES.has(type)) {
      log.add(true, `unknown event type ${JSON.stringify(type)}`);
      return;
    }
    if (type === 'thread.started') {
      log.keys(ev, set('type', 'thread_id'), 'thread.started');
      if (typeof ev['thread_id'] === 'string') sessionId = ev['thread_id'];
      return;
    }
    if (!type.startsWith('item.')) return;
    log.keys(ev, set('type', 'item'), type);
    const item = obj(ev['item']);
    const id = item?.['id'];
    if (!item || typeof id !== 'string') {
      log.add(true, `${type} without an item id`);
      return;
    }
    if (!latest.has(id)) {
      order.push(id);
      firstLine.set(id, i);
    }
    latest.set(id, item);
    lastLine.set(id, i);
  });

  const events: TranscriptEvent[] = [];
  const itemOf: string[] = [];
  for (const id of order) {
    const item = latest.get(id)!;
    const push = (e: TranscriptEvent): void => {
      events.push(e);
      itemOf.push(id);
    };
    const itype = String(item['type']);
    const fields = ITEM_FIELDS[itype];
    if (!fields) {
      log.add(true, `unknown item type "${itype}": it could run tests or edit files`);
      push({ kind: 'opaque', what: `item ${itype}` });
      continue;
    }
    log.keys(item, fields, `${itype} item`);
    if (INERT_ITEMS.has(itype)) continue;
    if (itype === 'mcp_tool_call') {
      log.opaque(`MCP tool "${String(item['server'])}.${String(item['tool'])}": what it did is not in the transcript; it could run tests or edit files`);
      push({ kind: 'opaque', what: 'mcp tool' });
      continue;
    }
    if (itype === 'agent_message') {
      log.type(item['text'], 'string', 'agent_message.text');
      push({ kind: 'message', text: String(item['text'] ?? ''), messageId: null });
    } else if (itype === 'command_execution') {
      log.type(item['command'], 'string', 'command_execution.command');
      log.type(item['aggregated_output'], 'string', 'command_execution.aggregated_output');
      log.type(item['exit_code'], 'number', 'command_execution.exit_code', true);
      const status = String(item['status']);
      if (!COMMAND_STATUS.has(status)) log.add(false, `command_execution: unknown status "${status}"`);
      if (status === 'declined') continue; // never ran
      const output = typeof item['aggregated_output'] === 'string' ? item['aggregated_output'] : '';
      const exit = status === 'in_progress' || typeof item['exit_code'] !== 'number' ? null : item['exit_code'];
      push({
        kind: 'shell',
        command: String(item['command'] ?? ''),
        dialect: 'posix',
        exit,
        output,
        truncated: output.includes(CODEX_TRUNCATED),
      });
    } else if (itype === 'file_change') {
      const status = String(item['status']);
      if (!CHANGE_STATUS.has(status)) log.add(false, `file_change: unknown status "${status}"`);
      if (status === 'failed') continue;
      const changes = Array.isArray(item['changes']) ? item['changes'] : [];
      if (!Array.isArray(item['changes'])) log.add(true, 'file_change: changes is not an array');
      for (const raw of changes) {
        const c = obj(raw);
        log.keys(c, CHANGE_FIELDS, 'file_change change');
        if (!c || typeof c['path'] !== 'string') {
          log.add(true, 'file_change change without a path');
          continue;
        }
        if (!CHANGE_KINDS.has(String(c['kind']))) log.add(false, `file_change: unknown kind "${String(c['kind'])}"`);
        push({ kind: 'edit', path: c['path'], via: 'patch', status: status === 'completed' ? 'ok' : 'unknown' });
      }
    }
  }
  // An item ends at its last line: the events of items that first appeared
  // before then ran at the same time (a command still in progress at the end
  // of the stream never ended).
  events.forEach((e, k) => {
    if (e.kind !== 'shell' && e.kind !== 'edit' && e.kind !== 'opaque') return;
    const item = latest.get(itemOf[k]!)!;
    // An opaque item (an MCP tool…) is never known to have finished: to the end of the stream.
    const last = item['status'] === 'in_progress' || e.kind === 'opaque' ? Infinity : lastLine.get(itemOf[k]!)!;
    let end = k + 1;
    while (end < events.length && firstLine.get(itemOf[end]!)! <= last) end++;
    const own = events.slice(k + 1, end).every((_, j) => itemOf[k + 1 + j] === itemOf[k]);
    if (!own) events[k] = { ...e, end };
  });
  return {
    agent: 'codex',
    format: 'codex-exec-json',
    version,
    sessionId,
    // `exec --json` records no directory, neither for the session nor per command.
    cwd: unknownCwd(NOT_RECORDED),
    events,
    ...messages(events),
    issues: log.issues,
  };
}
