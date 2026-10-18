// `saidvsdid run -- <command>`: runs a test command, streams its output, and
// records it as evidence/v2 with its exit status and the git tree of the
// working copy when it started (tracked and untracked, .gitignore respected),
// so the run can be tied to exact file contents.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EVIDENCE_SCHEMA_ID, type Evidence, type Run } from './evidence/schema.js';
import { classifySegment, packageScripts, parseSummary, segmentStatus } from './transcript/commands.js';
import { segments, type Dialect } from './transcript/shell.js';

export interface RunIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

function gitOut(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env }).trim();
  } catch {
    return null;
  }
}

/** Tree id of the working copy, built in a throw-away index (the real index is not touched). */
export function workingTreeSha(cwd: string): string | null {
  const root = gitOut(cwd, ['rev-parse', '--show-toplevel']);
  if (!root) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'saidvsdid-index-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(tmp, 'index') };
    if (gitOut(root, ['add', '-A', '--', '.'], env) === null) return null;
    return gitOut(root, ['write-tree'], env);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const quote = (arg: string, dialect: Dialect): string => {
  if (/^[\w./:=,@+-]+$/.test(arg)) return arg;
  return dialect === 'cmd' ? `"${arg.replace(/"/g, '""')}"` : `'${arg.replace(/'/g, `'\\''`)}'`;
};

export async function runWrapped(argv: string[], io: RunIo): Promise<{ exitCode: number; evidence: Evidence }> {
  const dialect: Dialect = process.platform === 'win32' ? 'cmd' : 'posix';
  const command = argv.length === 1 ? argv[0]! : argv.map((a) => quote(a, dialect)).join(' ');
  const treeSha = workingTreeSha(io.cwd);
  // The commit the run is about only when the working copy is exactly that commit's tree; otherwise
  // tree_sha alone ties the run to the code (a commit made later with this tree).
  const headCommit = gitOut(io.cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const head = headCommit !== null && treeSha !== null && gitOut(io.cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{tree}']) === treeSha ? headCommit : null;
  // Where it runs, as git places it in the repository ('' for its root); outside one, as is.
  const prefix = gitOut(io.cwd, ['rev-parse', '--show-prefix']);
  const where = prefix === null ? io.cwd : prefix.replace(/\/$/, '');
  let text: string | null = null;
  try {
    text = readFileSync(join(io.cwd, 'package.json'), 'utf8');
  } catch {
    text = null;
  }
  const scripts = packageScripts(text);

  const chunks: Buffer[] = [];
  const exit = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, { cwd: io.cwd, shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
    child.stdout.on('data', (c: Buffer) => {
      chunks.push(c);
      io.stdout(c.toString('utf8'));
    });
    child.stderr.on('data', (c: Buffer) => {
      chunks.push(c);
      io.stderr(c.toString('utf8'));
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
  const output = Buffer.concat(chunks).toString('utf8');

  const segs = segments(command, dialect);
  const runs: Run[] = [];
  const base = (partial: Pick<Run, 'command' | 'recognized' | 'framework' | 'selection' | 'exit_code' | 'exit_unknown'>): Run => ({
    id: `r${runs.length + 1}`,
    seq: runs.length,
    cwd: where,
    source: 'wrapper',
    tree_sha: treeSha,
    summary: null,
    tests: [],
    output_sha256: createHash('sha256').update(output).digest('hex'),
    output_truncated: false,
    ...partial,
  });
  segs.forEach((seg, k) => {
    const kind = classifySegment(seg.text, dialect, scripts);
    if (kind.kind !== 'test' && kind.kind !== 'possible_test') return;
    runs.push(
      base({
        command: seg.text,
        recognized: kind.kind === 'test',
        framework: kind.kind === 'test' ? kind.framework : 'unknown',
        selection: kind.kind === 'test' ? kind.selection : 'unknown',
        ...(({ exit: exitCode, unknown }) => ({ exit_code: exitCode, exit_unknown: unknown }))(segmentStatus(segs, k, exit)),
      }),
    );
  });
  // Not a test command we recognise: still recorded, never counted as a pass.
  if (runs.length === 0) runs.push(base({ command, recognized: false, framework: 'unknown', selection: 'unknown', exit_code: exit, exit_unknown: exit === null ? 'no_result' : null }));
  if (runs.length === 1) {
    const parsed = parseSummary(output, runs[0]!.framework);
    if (parsed) {
      runs[0]!.summary = parsed.summary;
      if (runs[0]!.framework === 'unknown' && runs[0]!.recognized) runs[0]!.framework = parsed.framework;
    }
  }
  return {
    exitCode: exit ?? 1,
    evidence: {
      schema: EVIDENCE_SCHEMA_ID,
      agent: { name: 'other', version: '', session_id: '' },
      repo: { base: null, head },
      transcript: { format: null, complete: true, issues: [] },
      claims: [],
      runs,
      edits: [],
    },
  };
}
