#!/usr/bin/env node
// Runs the transcript adapters and TG006 over your local agent history and
// prints aggregate statistics plus session ids: how many sessions claim the
// suite passes, and how many of those TG006 would FAIL or WARN.
//
//   npm run build
//   node bench/scan-history.mjs [--json] [--claude-dir <dir>] [--codex-dir <dir>]
//
// Defaults: ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects) and
// ~/.codex/sessions (or $CODEX_HOME/sessions) when they exist.
//
// READ-ONLY. Nothing from the sessions — messages, commands, paths, claims —
// is printed or written: only counts and session ids. Open a session yourself
// (claude --resume <id>, or the file under ~/.codex/sessions) to look at it.
// "adapter gaps" counts transcripts with content the adapters do not recognise;
// "opaque" counts those that call MCP tools or subagents they cannot see into.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1] ?? null;
};
const dist = new URL('../dist/scan.js', import.meta.url);
if (!existsSync(dist)) {
  console.error('scan-history: build first (npm run build)');
  process.exit(2);
}
const { scanHistory, renderScan } = await import(dist.href);

const claudeDefault = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
const codexDefault = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
const claude = value('--claude-dir') ?? (existsSync(claudeDefault) ? claudeDefault : null);
const codex = value('--codex-dir') ?? (existsSync(codexDefault) ? codexDefault : null);
if (!claude && !codex) {
  console.error('scan-history: no ~/.claude/projects or ~/.codex/sessions found (use --claude-dir / --codex-dir)');
  process.exit(2);
}
const result = scanHistory({ claude, codex });
process.stdout.write(args.includes('--json') ? JSON.stringify(result, null, 2) + '\n' : renderScan(result));
