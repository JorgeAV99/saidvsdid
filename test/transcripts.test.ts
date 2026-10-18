// Contract tests: the adapters against the real sessions in fixtures/sessions/.
// Anything the adapters do not recognise fails here, loudly, first.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CASES_DIR, SESSIONS_DIR } from '../fixtures/build.js';
import { derive } from '../scripts/derive-transcripts.mjs';
import { evidenceFromSession } from '../src/evidence/from-transcript.js';
import { validateEvidence } from '../src/evidence/schema.js';
import { assertKnown, detectAgent, parseTranscript } from '../src/transcript/index.js';
import { localPath } from '../src/transcript/codex-rollout.js';

interface SessionMeta {
  agent: 'claude' | 'codex';
  agentVersion: string;
  scenario: string;
  toy: string;
  baseSha: string;
  headSha: string;
  lastMessage: string;
}

const sessions = readdirSync(SESSIONS_DIR).sort();
const meta = (name: string): SessionMeta => JSON.parse(readFileSync(join(SESSIONS_DIR, name, 'session.json'), 'utf8')) as SessionMeta;
const read = (name: string, file: string): string => readFileSync(join(SESSIONS_DIR, name, file), 'utf8');
const lines = (text: string): Record<string, unknown>[] => text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
const unlines = (records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n';
const transcripts = sessions.flatMap((s) => ['transcript.jsonl', 'interactive.jsonl', 'rollout.jsonl'].filter((f) => existsSync(join(SESSIONS_DIR, s, f))).map((f) => [s, f] as const));

const workdir = mkdtempSync(join(tmpdir(), 'saidvsdid-sessions-'));
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

describe('recorded sessions', () => {
  it('are the 8 recordings (2 agents × 4 scenarios) plus the blocked Codex sandbox', () => {
    expect(sessions).toEqual([
      'claude-honest', 'claude-impossible', 'claude-regression', 'claude-stale',
      'codex-blocked-sandbox', 'codex-honest', 'codex-impossible', 'codex-regression', 'codex-stale',
    ]);
  });

  it.each(sessions)('%s stores its agent version, the headless transcript, (Claude) the interactive JSONL and (Codex) the rollout', (name) => {
    const m = meta(name);
    expect(m.agentVersion).toMatch(m.agent === 'claude' ? /^\d+\.\d+\.\d+ \(Claude Code\)$/ : /^codex-cli \d+\.\d+\.\d+$/);
    for (const f of ['transcript.jsonl', 'diff.patch', 'base', 'head']) expect(existsSync(join(SESSIONS_DIR, name, f)), f).toBe(true);
    expect(existsSync(join(SESSIONS_DIR, name, 'interactive.jsonl'))).toBe(m.agent === 'claude');
    expect(existsSync(join(SESSIONS_DIR, name, 'rollout.jsonl'))).toBe(m.agent === 'codex');
  });

  // The recorder commits base and head with a fixed identity and date: the
  // trees must reproduce the recorded SHAs, and diff.patch must be their diff.
  it.each(sessions)('%s: base/ and head/ reproduce the recorded commits and diff.patch', (name) => {
    const m = meta(name);
    const repo = join(workdir, name);
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'saidvsdid-bench', GIT_AUTHOR_EMAIL: 'bench@saidvsdid.invalid',
      GIT_COMMITTER_NAME: 'saidvsdid-bench', GIT_COMMITTER_EMAIL: 'bench@saidvsdid.invalid',
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    };
    const git = (...args: string[]): string =>
      execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, env, encoding: 'utf8', maxBuffer: 1 << 26 });
    cpSync(join(SESSIONS_DIR, name, 'base'), repo, { recursive: true });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', `toy ${m.toy}: ${m.scenario}`);
    expect(git('rev-parse', 'HEAD').trim()).toBe(m.baseSha);
    for (const e of readdirSync(repo)) if (e !== '.git') rmSync(join(repo, e), { recursive: true, force: true });
    cpSync(join(SESSIONS_DIR, name, 'head'), repo, { recursive: true });
    git('add', '-A');
    if (m.headSha !== m.baseSha) git('commit', '-q', '-m', 'agent session');
    expect(git('rev-parse', 'HEAD').trim()).toBe(m.headSha);
    expect(git('diff', '--binary', m.baseSha, m.headSha)).toBe(read(name, 'diff.patch'));
  });

  it.each(transcripts)('%s/%s parses with nothing unrecognised (contract)', (name, file) => {
    const m = meta(name);
    const text = read(name, file);
    expect(detectAgent(text)).toBe(m.agent);
    const session = parseTranscript(text);
    expect(() => assertKnown(session)).not.toThrow();
    expect(session.format).toBe(m.agent === 'codex' ? (file === 'rollout.jsonl' ? 'codex-rollout' : 'codex-exec-json') : file === 'interactive.jsonl' ? 'claude-jsonl' : 'claude-stream-json');
    if (m.agent === 'claude') expect(m.agentVersion.startsWith(`${session.version} `)).toBe(true);
    expect(session.sessionId).not.toBe('');
    expect(session.lastMessage?.text.trim()).toBe(m.lastMessage.trim());
    const evidence = evidenceFromSession(session);
    expect(validateEvidence(evidence)).toMatchObject({ ok: true });
    expect(evidence.transcript).toEqual({ format: session.format, complete: true, issues: [] });
  });

  // `codex exec` writes the session twice: its `--json` stream and its rollout. Same
  // claims, edits and commands; only the rollout records where each command ran.
  it.each(sessions.filter((s) => meta(s).agent === 'codex'))('%s: the rollout is the exec stream, with the directory of each command', (name) => {
    const exec = parseTranscript(read(name, 'transcript.jsonl'));
    const roll = parseTranscript(read(name, 'rollout.jsonl'));
    expect(roll.sessionId).toBe(exec.sessionId);
    const e = evidenceFromSession(exec, { cwd: '<REPO>' });
    const r = evidenceFromSession(roll);
    expect(r.claims.map((c) => [c.kind, c.text, c.certainty])).toEqual(e.claims.map((c) => [c.kind, c.text, c.certainty]));
    expect(r.edits.filter((x) => x.via !== 'shell').map((x) => x.path)).toEqual(e.edits.filter((x) => x.via !== 'shell').map((x) => x.path));
    expect(r.runs.map((x) => x.command)).toEqual(e.runs.map((x) => x.command));
    // The stream never places a run, even with --cwd; the rollout places those in the grammar.
    expect(e.runs.every((x) => x.cwd === null)).toBe(true);
    if (r.runs.length) expect(r.runs.some((x) => x.cwd === '')).toBe(true);
  });

  it.each(sessions.filter((s) => meta(s).agent === 'claude'))('%s: the interactive JSONL and the stream give the same evidence', (name) => {
    // The JSONL also records the user's prompt, which the stream does not: compare
    // positions by their order, not their values.
    const strip = (text: string): unknown => {
      const e = evidenceFromSession(parseTranscript(text));
      const ranks = [...new Set([...e.claims, ...e.runs, ...e.edits].map((x) => x.seq))].sort((a, b) => a - b);
      const rank = <T extends { seq: number }>(x: T): T => ({ ...x, seq: ranks.indexOf(x.seq) });
      return { claims: e.claims.map(rank), runs: e.runs.map(rank), edits: e.edits.map(rank), agent: e.agent };
    };
    expect(strip(read(name, 'interactive.jsonl'))).toEqual(strip(read(name, 'transcript.jsonl')));
  });
});

describe('adapters fail loudly on what they do not know', () => {
  const claude = lines(read('claude-honest', 'transcript.jsonl'));
  const codex = lines(read('codex-honest', 'transcript.jsonl'));
  const issues = (text: string): { hides: boolean; text: string }[] => parseTranscript(text).issues;

  it('an unknown field on a Claude tool call', () => {
    const edited = claude.map((r) => {
      const content = (r['message'] as { content?: unknown } | undefined)?.content;
      if (!Array.isArray(content)) return r;
      return { ...r, message: { ...(r['message'] as object), content: content.map((b: Record<string, unknown>) => (b['name'] === 'Bash' ? { ...b, input: { ...(b['input'] as object), sandbox: 'strict' } } : b)) } };
    });
    expect(issues(unlines(edited))).toContainEqual({ hides: false, text: 'Bash input: unknown field "sandbox"' });
    expect(() => assertKnown(parseTranscript(unlines(edited)))).toThrow(/Bash input: unknown field "sandbox"/);
  });

  it('an unknown Claude record type or tool could hide a run: the transcript is incomplete', () => {
    const edited = [...claude.slice(0, 3), { type: 'tool_progress', uuid: 'x' }, ...claude.slice(3)];
    expect(issues(unlines(edited))).toContainEqual({ hides: true, text: 'unknown record type "tool_progress"' });
    const mcp = claude.map((r) =>
      r['type'] === 'assistant' && JSON.stringify(r).includes('"name":"Read"')
        ? { ...r, message: { ...(r['message'] as object), content: [{ type: 'tool_use', id: 'toolu_x', name: 'mcp__ci__run', input: {} }] } }
        : r,
    );
    const session = parseTranscript(unlines(mcp));
    const e = evidenceFromSession(session);
    expect(e.transcript.complete).toBe(false);
    // Recognised but opaque: strict mode accepts it, completeness does not.
    expect(session.issues).toContainEqual({ hides: true, opaque: true, text: 'MCP tool "mcp__ci__run": what it did is not in the transcript; it could run tests or edit files' });
    expect(() => assertKnown(session)).not.toThrow();
    const unknownTool = mcp.map((r) => JSON.parse(JSON.stringify(r).replace('mcp__ci__run', 'Teleport')) as Record<string, unknown>);
    expect(issues(unlines(unknownTool))).toContainEqual({ hides: true, text: 'unknown tool "Teleport": it could run tests or edit files' });
  });

  it('an unknown Codex field, item type or event type', () => {
    const field = codex.map((r) => ((r['item'] as { type?: string } | undefined)?.type === 'command_execution' ? { ...r, item: { ...(r['item'] as object), duration_ms: 5 } } : r));
    expect(issues(unlines(field))).toContainEqual({ hides: false, text: 'command_execution item: unknown field "duration_ms"' });
    const item = [...codex.slice(0, 2), { type: 'item.completed', item: { id: 'item_x', type: 'collab_tool_call' } }, ...codex.slice(2)];
    expect(issues(unlines(item))).toContainEqual({ hides: true, text: 'unknown item type "collab_tool_call": it could run tests or edit files' });
    const event = [...codex.slice(0, 2), { type: 'session.configured' }, ...codex.slice(2)];
    expect(issues(unlines(event))).toContainEqual({ hides: true, text: 'unknown event type "session.configured"' });
  });
});

describe('Claude adapter details', () => {
  const stale = lines(read('claude-stale', 'transcript.jsonl'));

  it('pairs tool_use and tool_result by id; a string toolUseResult is an error text', () => {
    // claude-honest's first Bash call exited 2 and its tool_use_result is the string "Error: Exit code 2 …".
    const records = lines(read('claude-honest', 'transcript.jsonl'));
    expect(records.some((r) => typeof r['tool_use_result'] === 'string')).toBe(true);
    const shells = parseTranscript(read('claude-honest', 'transcript.jsonl')).events.filter((e) => e.kind === 'shell');
    expect(shells.map((e) => (e.kind === 'shell' ? e.exit : 'x'))).toEqual([2, 0]);
  });

  it('de-duplicates records by uuid: the last copy wins, at the position of the first', () => {
    const last = [...stale].reverse().find((r) => r['type'] === 'assistant' && JSON.stringify(r).includes('"type":"text"'))!;
    const copy = { ...last, message: { ...(last['message'] as object), content: [{ type: 'text', text: 'All 6 tests pass.' }] } };
    const session = parseTranscript(unlines([...stale, copy]));
    expect(session.lastMessage?.text).toBe('All 6 tests pass.');
    expect(session.events.length).toBe(parseTranscript(unlines(stale)).events.length);
  });

  it('orders by position in the transcript, never by timestamps', () => {
    const stamps = stale.map((r) => r['timestamp']).filter((t) => typeof t === 'string').reverse();
    let i = 0;
    const shuffled = stale.map((r) => (typeof r['timestamp'] === 'string' ? { ...r, timestamp: stamps[i++] } : r));
    expect(evidenceFromSession(parseTranscript(unlines(shuffled)))).toEqual(evidenceFromSession(parseTranscript(unlines(stale))));
  });
});

describe('formats met in real desktop-app sessions (synthetic fixtures)', () => {
  const derived = (c: string): string => readFileSync(join(CASES_DIR, 'TG006', c, 'transcript.jsonl'), 'utf8');

  it.each(['claude-desktop-format', 'claude-denied-rerun', 'claude-bash-edit-after-run', 'codex-rollout-honest', 'codex-rollout-edit-after-run', 'codex-rollout-subagent', 'codex-rollout-mcp-readonly'])(
    '%s parses with nothing unrecognised',
    (c) => {
      expect(() => assertKnown(parseTranscript(derived(c)))).not.toThrow();
    },
  );

  it('a Codex rollout gives the same evidence as the exec stream of the same session', () => {
    const strip = (text: string): unknown => {
      const e = evidenceFromSession(parseTranscript(text));
      return { claims: e.claims, runs: e.runs.map(({ cwd: _, ...r }) => r), edits: e.edits };
    };
    expect(strip(derived('codex-rollout-honest'))).toEqual(strip(read('codex-honest', 'transcript.jsonl')));
    expect(parseTranscript(derived('codex-rollout-honest'))).toMatchObject({ format: 'codex-rollout', version: '0.158.0' });
  });

  it('rollout: AgentMessage text is `Text`; an unknown content type is reported, not dropped silently', () => {
    const text = derived('codex-rollout-honest').replace(/"type":"Text"/g, '"type":"Markdown"');
    const session = parseTranscript(text);
    expect(session.issues).toContainEqual({ hides: false, text: 'AgentMessage: unknown content type "Markdown"' });
    expect(() => assertKnown(session)).toThrow();
  });

  it('bashEditDiff: the files a Bash command changed are certain edits, placed before its own runs', () => {
    const e = evidenceFromSession(parseTranscript(derived('claude-bash-edit-after-run')));
    const run = e.runs.find((r) => r.recognized)!;
    const shellEdits = e.edits.filter((x) => x.via === 'shell');
    expect(shellEdits.map((x) => [x.certainty, x.path])).toEqual([['certain', 'src/stats.ts'], ['uncertain', null]]);
    expect(shellEdits.every((x) => x.seq > run.seq)).toBe(true);
    // Inside one command, the reported files come before that command's run.
    const records = lines(derived('claude-bash-edit-after-run')).map((r) => JSON.parse(JSON.stringify(r).replace('python tools/format.py', 'npm test')) as Record<string, unknown>);
    const same = evidenceFromSession(parseTranscript(unlines(records)));
    const lastRun = same.runs[same.runs.length - 1]!;
    expect(same.edits.filter((x) => x.via === 'shell').map((x) => x.seq < lastRun.seq)).toEqual([true]);
  });

  it('persistedOutputPath: the result holds a preview, so the output is truncated', () => {
    const records = lines(read('claude-honest', 'interactive.jsonl')).map((r) => {
      const tur = r['toolUseResult'] as Record<string, unknown> | undefined;
      return tur && typeof tur === 'object' && typeof tur['stdout'] === 'string' && String(tur['stdout']).includes('Tests')
        ? { ...r, toolUseResult: { ...tur, persistedOutputPath: '<HOME>/.claude/out.txt', persistedOutputSize: 99999 } }
        : r;
    });
    expect(evidenceFromSession(parseTranscript(unlines(records))).runs[0]!.output_truncated).toBe(true);
  });

  it('Codex exec: an MCP tool call is recognised and opaque', () => {
    const records = lines(read('codex-honest', 'transcript.jsonl'));
    const withMcp = [...records.slice(0, 3), { type: 'item.completed', item: { id: 'item_x', type: 'mcp_tool_call', server: 'ci', tool: 'rerun', arguments: {}, result: null, error: null, status: 'completed' } }, ...records.slice(3)];
    const session = parseTranscript(unlines(withMcp));
    expect(session.issues).toEqual([{ hides: true, opaque: true, text: 'MCP tool "ci.rerun": what it did is not in the transcript; it could run tests or edit files' }]);
  });
});

describe('Codex adapter details', () => {
  it('a rollout writes working directories as file: URIs (RFC 8089), read exactly', () => {
    expect(localPath('file:///C:/Users/a/repo')).toBe('C:/Users/a/repo');
    expect(localPath('file:///home/a/my%20repo')).toBe('/home/a/my repo');
    expect(localPath('file:///<REPO>')).toBe('<REPO>');
    expect(localPath('file://localhost/tmp/x')).toBe('/tmp/x');
    expect(localPath('C:\\x')).toBe('C:\\x');
    // another host, or a URI that does not decode: no local directory
    expect(localPath('file://server/share/x')).toBeNull();
    expect(localPath('file:///bad%zz')).toBeNull();
  });

  it('"...(truncated)" marks the output as truncated', () => {
    const records = lines(read('codex-stale', 'transcript.jsonl')).map((r) => {
      const item = r['item'] as { type?: string; aggregated_output?: string } | undefined;
      return item?.type === 'command_execution' && item.aggregated_output?.includes('passed') ? { ...r, item: { ...item, aggregated_output: `${item.aggregated_output}...(truncated)` } } : r;
    });
    const run = evidenceFromSession(parseTranscript(unlines(records))).runs.find((r) => r.recognized)!;
    expect(run.output_truncated).toBe(true);
  });

  it('a declined command never ran; an item without completion has an unknown exit status', () => {
    const records = lines(read('codex-stale', 'transcript.jsonl'));
    const declined = records.map((r) => ((r['item'] as { command?: string } | undefined)?.command?.includes("'python -m pytest'") ? { ...r, item: { ...(r['item'] as object), status: 'declined', exit_code: null } } : r));
    expect(evidenceFromSession(parseTranscript(unlines(declined))).runs).toEqual([]);
    const started = records.filter((r) => !(r['type'] === 'item.completed' && (r['item'] as { command?: string } | undefined)?.command?.includes("'python -m pytest'")));
    expect(evidenceFromSession(parseTranscript(unlines(started))).runs.map((r) => r.exit_code)).toEqual([null]);
  });
});

describe('when a call ran: its start and its end', () => {
  const evidenceOf = (c: string) => evidenceFromSession(parseTranscript(readFileSync(join(CASES_DIR, c, 'transcript.jsonl'), 'utf8')));

  // A rollout records an item when it completes, inside the model's `exec` call: items of one call (a patch
  // and a test run in the same program) may run in any order, so they span the call (see codex-rollout-edit-in-run-call).
  it.each(transcripts.filter(([, f]) => f !== 'rollout.jsonl'))('%s/%s: every call ends before the next starts, so runs and edits are points', (name, file) => {
    const e = evidenceFromSession(parseTranscript(read(name, file)));
    expect([...e.runs, ...e.edits].filter((x) => x.seq_end !== undefined)).toEqual([]);
  });

  it.each(['TG006/claude-edit-during-run', 'TG006/codex-edit-during-run', 'TG006/codex-rollout-edit-in-run-call', 'TG006/codex-rollout-edit-before-run-same-call'])(
    '%s: the edit falls inside the last run, neither before nor after it',
    (c) => {
      const e = evidenceOf(c);
      const run = e.runs.filter((r) => r.recognized).at(-1)!;
      const inside = e.edits.filter((x) => x.seq <= (run.seq_end ?? run.seq) && (x.seq_end ?? x.seq) >= run.seq);
      expect(inside.map((x) => [x.certainty, x.path])).toEqual([['certain', c.startsWith('TG006/claude') ? 'test/stats.test.ts' : 'src/stats.ts']]);
    },
  );

  it('Codex exec: a command still in progress at the end of the stream never ended', () => {
    const records = lines(read('codex-stale', 'transcript.jsonl'));
    const started = records.filter((r) => !(r['type'] === 'item.completed' && (r['item'] as { command?: string } | undefined)?.command?.includes("'python -m pytest'")));
    const e = evidenceFromSession(parseTranscript(unlines(started)));
    const run = e.runs[0]!;
    expect(run.seq_end).toBeGreaterThan(Math.max(...e.edits.map((x) => x.seq)));
  });

  it('Codex rollout: a commentary message is not the end of the turn', () => {
    const session = parseTranscript(readFileSync(join(CASES_DIR, 'CLAIM-CONTEXT', 'codex-rollout-edit-after-claim', 'transcript.jsonl'), 'utf8'));
    expect(session.turnEnds).toEqual([]);
    const final = parseTranscript(readFileSync(join(CASES_DIR, 'TG006', 'codex-rollout-honest', 'transcript.jsonl'), 'utf8'));
    expect(final.turnEnds).toHaveLength(1);
  });

  it('evidence/v2: seq_end is optional and never before seq', () => {
    const e = evidenceOf('TG006/claude-edit-during-run');
    expect(validateEvidence(e).ok).toBe(true);
    const run = e.runs.at(-1)!;
    expect(validateEvidence({ ...e, runs: [{ ...run, seq_end: run.seq - 1 }] })).toMatchObject({ ok: false, errors: ['$.runs[0].seq_end: must not be less than seq'] });
  });
});

describe('derived fixtures', () => {
  it('are up to date with scripts/derive-transcripts.mjs', () => {
    const files = derive();
    const stale = Object.entries(files).filter(([p, text]) => !existsSync(join(CASES_DIR, p)) || readFileSync(join(CASES_DIR, p), 'utf8') !== text).map(([p]) => p);
    expect(stale).toEqual([]);
  });
});

describe('privacy of the recorded and derived transcripts', () => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(jsonl|json|patch)$/.test(e)) files.push(p);
    }
  };
  walk(SESSIONS_DIR);
  walk(CASES_DIR);
  // Home directories, emails, account ids and tokens: test/privacy.test.ts, over every versioned file.
  it('no recorded transcript keeps an organisation id', () => {
    const found = files.filter((f) => /"organizationUuid"\s*:\s*"(?!<REDACTED>")/.test(readFileSync(f, 'utf8'))).map((f) => relative(join(SESSIONS_DIR, '..'), f));
    expect(found).toEqual([]);
  });

  // Transcripts keep only what the adapters read (scripts/record-session.mjs: minimalClaude,
  // minimalRollout): never the system prompt, the instructions, the tool definitions, the
  // environment or the account the agent ran with.
  const HARNESS_KEYS = new Set([
    'systemPrompt', 'system_prompt', 'base_instructions', 'developer_instructions', 'user_instructions', 'instructions',
    'tools', 'inlineTools', 'mcp_servers', 'skills', 'slash_commands', 'agents', 'plugins', 'snapshot', 'organizationUuid',
    'environment_context', 'modelUsage',
  ]);
  const HARNESS_RECORDS = new Set(['attachment', 'turn_context', 'cost-state', 'rate_limit_event']);
  const harness = (v: unknown, at: string): string[] => {
    if (Array.isArray(v)) return v.flatMap((x, i) => harness(x, `${at}[${i}]`));
    if (typeof v !== 'object' || v === null) return [];
    return Object.entries(v).flatMap(([k, x]) => [...(HARNESS_KEYS.has(k) ? [`${at}.${k}`] : []), ...harness(x, `${at}.${k}`)]);
  };
  it('no recorded or derived transcript keeps instructions, tool definitions or harness records', () => {
    const found = files
      .filter((f) => f.endsWith('.jsonl'))
      .flatMap((f) =>
        lines(readFileSync(f, 'utf8')).flatMap((r, i) => {
          const where = `${relative(join(SESSIONS_DIR, '..'), f)}:${i + 1}`;
          return [...(HARNESS_RECORDS.has(String(r['type'])) ? [`${where} ${String(r['type'])} record`] : []), ...harness(r, where)];
        }),
      );
    expect(found).toEqual([]);
  });

  it('the check sees the records the eighth review found', () => {
    expect(harness({ type: 'attachment', attachment: { type: 'prompt_snapshot', systemPrompt: 'x', tools: [] } }, 'r')).toEqual(['r.attachment.systemPrompt', 'r.attachment.tools']);
    expect(harness({ type: 'system', subtype: 'init', tools: ['Bash'], mcp_servers: [] }, 'r')).toEqual(['r.tools', 'r.mcp_servers']);
    expect(harness({ type: 'session_meta', payload: { base_instructions: { text: 'x' } } }, 'r')).toEqual(['r.payload.base_instructions']);
  });

  it('record-session reduces a Claude transcript to what the adapter reads, idempotently', async () => {
    const { minimalClaude } = await import('../scripts/record-session.mjs');
    for (const name of sessions.filter((s) => meta(s).agent === 'claude')) {
      for (const file of ['transcript.jsonl', 'interactive.jsonl']) expect(minimalClaude(read(name, file))).toBe(read(name, file));
    }
    const raw = [
      { type: 'system', subtype: 'init', cwd: '<REPO>', session_id: 's', tools: ['Bash'], mcp_servers: [], claude_code_version: '2' },
      { type: 'attachment', attachment: { type: 'prompt_snapshot', systemPrompt: 'secret' } },
    ].map((r) => JSON.stringify(r)).join('\n');
    expect(minimalClaude(raw)).toBe(`${JSON.stringify({ type: 'system', subtype: 'init', cwd: '<REPO>', session_id: 's', claude_code_version: '2' })}\n`);
  });
});
