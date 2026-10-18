// --f2p: does the regression test the agent added fail without its fix?
//
// THIS RUNS CODE FROM THE REPOSITORY (its tests, its configuration, whatever
// they import). It is opt-in and documented as such.
//
// Two detached git worktrees are created in a temporary directory, one at
// base and one at head. The head version of every test file that holds a new
// or modified test is copied into the base worktree; nothing else from head
// is. Then only those test ids are run on both sides, with a timeout, using the
// repository's own runner (its node_modules is linked into the worktrees;
// Python is `python`/`python3`, or $SAIDVSDID_PYTHON). Any failure to run —
// missing runner, crash, timeout, a test that was not collected — is reported
// as a reason, never as a result.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { git, readBlob } from './git/diff.js';

export type F2pStatus = 'passed' | 'failed' | 'error' | 'skipped' | 'missing';

export interface F2pTarget {
  /** Repo-relative head path of the test file. */
  file: string;
  /** TestCase.name: `describe > test` (JS/TS) or `Class::test` (Python). */
  name: string;
  /**
   * A parametrised test (`it.each`, `describe.each`, `parametrize`): the
   * runner reports one id per row. The rows must be the same on both sides and
   * distinguishable, or the result is `missing` (UNVERIFIABLE, never FAIL).
   */
  table?: boolean;
}

export type F2pResult =
  | { ok: true; base: Map<string, F2pStatus>; head: Map<string, F2pStatus> }
  | { ok: false; reason: string };

type Runner = 'vitest' | 'jest' | 'pytest';

const key = (t: F2pTarget): string => `${t.file}\0${t.name}`;

function runnerFor(file: string, headSource: string | null, pkg: Record<string, unknown> | null): Runner | string {
  if (file.endsWith('.py')) return 'pytest';
  if (headSource && /from\s+['"]vitest['"]/.test(headSource)) return 'vitest';
  const deps = { ...(pkg?.['devDependencies'] as object | undefined), ...(pkg?.['dependencies'] as object | undefined) };
  const hasVitest = 'vitest' in deps;
  const hasJest = 'jest' in deps;
  if (hasVitest && !hasJest) return 'vitest';
  if (hasJest && !hasVitest) return 'jest';
  return `cannot tell whether ${file} runs with vitest or jest`;
}

function linkNodeModules(repoDir: string, worktree: string): void {
  const source = join(repoDir, 'node_modules');
  const target = join(worktree, 'node_modules');
  if (existsSync(target)) return;
  mkdirSync(target);
  for (const entry of readdirSync(source)) {
    if (entry.startsWith('.') && entry !== '.bin') continue;
    symlinkSync(join(source, entry), join(target, entry), 'junction');
  }
}

/** Removes links first, without following them, so the repository's node_modules is never touched. */
function unlinkNodeModules(worktree: string): void {
  const nm = join(worktree, 'node_modules');
  if (!existsSync(nm)) return;
  for (const entry of readdirSync(nm)) {
    const p = join(nm, entry);
    if (!lstatSync(p).isSymbolicLink()) continue;
    try {
      unlinkSync(p);
    } catch {
      rmdirSync(p);
    }
  }
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Records the outcome of every collected test by node id, and collection errors by file.
const PYTEST_PLUGIN = String.raw`
import json, os

_statuses = {}

def pytest_collectreport(report):
    if report.failed:
        _statuses["collect::" + str(report.nodeid)] = "error"

def pytest_runtest_logreport(report):
    nodeid = report.nodeid
    if report.when == "call":
        if report.passed:
            _statuses[nodeid] = "passed"
        elif report.skipped:
            _statuses[nodeid] = "skipped"
        else:
            _statuses[nodeid] = "failed"
    elif report.failed:
        _statuses[nodeid] = "error"
    elif report.skipped and nodeid not in _statuses:
        _statuses[nodeid] = "skipped"

def pytest_sessionfinish(session, exitstatus):
    with open(os.environ["SAIDVSDID_F2P_OUT"], "w", encoding="utf-8") as f:
        json.dump(_statuses, f)
`;

interface SideRun {
  statuses: Map<string, F2pStatus>;
  /** Row ids the runner reported, per parametrised target (sorted; null when ambiguous). */
  rows?: Map<string, string[] | null>;
  problem: string | null;
}

/** One status for a test from its rows: any error or failure fails it; it passes only if every row passed. */
function aggregate(statuses: string[]): F2pStatus {
  if (statuses.length === 0) return 'missing';
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('failed')) return 'failed';
  return statuses.every((s) => s === 'passed') ? 'passed' : 'skipped';
}

/**
 * A title template → a pattern for the titles the runner generates from it:
 * printf placeholders (`%s`, `%d`, `%j`, `%#`…) and `$variable`s match anything.
 */
function templatePattern(title: string): string {
  return escapeRe(title)
    .replace(/%[sdifjoOpc#]/g, '.*?')
    .replace(/\\\$[\w.]+/g, '.*?');
}

function runPytest(worktree: string, targets: F2pTarget[], work: string, side: string, timeoutMs: number): SideRun {
  const pluginDir = join(work, 'plugin');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'saidvsdid_f2p.py'), PYTEST_PLUGIN);
  const out = join(work, `${side}.pytest.json`);
  const python = process.env['SAIDVSDID_PYTHON'] || (process.platform === 'win32' ? 'python' : 'python3');
  const ids = targets.map((t) => `${t.file}::${t.name}`);
  const r = spawnSync(python, ['-m', 'pytest', '-p', 'saidvsdid_f2p', '-p', 'no:cacheprovider', '-q', ...ids], {
    cwd: worktree,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, PYTHONPATH: [pluginDir, process.env['PYTHONPATH']].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'), SAIDVSDID_F2P_OUT: out, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (r.error) return { statuses: new Map(), problem: `${python} could not run: ${(r.error as NodeJS.ErrnoException).code ?? r.error.message}` };
  if (r.signal) return { statuses: new Map(), problem: `pytest timed out after ${timeoutMs / 1000}s on ${side}` };
  if (!existsSync(out)) return { statuses: new Map(), problem: `pytest did not run on ${side} (exit ${r.status}): ${lastLine(r.stderr || r.stdout)}` };
  if (r.status !== null && r.status > 2) return { statuses: new Map(), problem: `pytest failed to run on ${side} (exit ${r.status}): ${lastLine(r.stdout || r.stderr)}` };
  const raw = JSON.parse(readFileSync(out, 'utf8')) as Record<string, F2pStatus>;
  const statuses = new Map<string, F2pStatus>();
  const rows = new Map<string, string[] | null>();
  for (const t of targets) {
    // Parametrised tests report one id per parameter (`test[a-2]`): all must pass for the test to pass.
    const id = `${t.file}::${t.name}`;
    const collect = Object.entries(raw).find(([k]) => k.startsWith('collect::') && (k === `collect::${t.file}` || k.endsWith(`/${t.file}`)));
    const own = Object.entries(raw).filter(([k]) => k === id || k.startsWith(`${id}[`) || k.endsWith(`/${id}`) || k.includes(`/${id}[`));
    statuses.set(key(t), collect ? 'error' : aggregate(own.map(([, v]) => v)));
    if (t.table) rows.set(key(t), own.map(([k]) => k.slice(k.indexOf('['))).sort());
  }
  return { statuses, rows, problem: null };
}

function runJs(runner: 'vitest' | 'jest', worktree: string, targets: F2pTarget[], work: string, side: string, timeoutMs: number): SideRun {
  const out = join(work, `${side}.${runner}.json`);
  const files = [...new Set(targets.map((t) => t.file))];
  // Both runners match -t against the test's full name, its describe chain joined
  // by spaces; a parametrised test's rows have titles generated from its template.
  const namePattern = (t: F2pTarget, sep: string): string =>
    t.table ? t.name.split(' > ').map(templatePattern).join(escapeRe(sep)) : escapeRe(t.name.split(' > ').join(sep));
  const pattern = `^(?:${targets.map((t) => namePattern(t, ' ')).join('|')})$`;
  const bin = runner === 'vitest' ? join(worktree, 'node_modules', 'vitest', 'vitest.mjs') : join(worktree, 'node_modules', 'jest', 'bin', 'jest.js');
  if (!existsSync(bin)) return { statuses: new Map(), problem: `${runner} is not installed in the repository's node_modules` };
  const args =
    runner === 'vitest'
      ? [bin, 'run', '--root', worktree, '--reporter=json', `--outputFile=${out}`, '--allowOnly', '--passWithNoTests', '-t', pattern, ...files]
      : [bin, '--ci', '--json', `--outputFile=${out}`, '--watchman=false', '--passWithNoTests', `--cacheDirectory=${join(work, `${side}.jest-cache`)}`, '-t', pattern, ...files.map(escapeRe)];
  const r = spawnSync(process.execPath, args, { cwd: worktree, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, CI: 'true', NO_COLOR: '1' } });
  if (r.signal) return { statuses: new Map(), problem: `${runner} timed out after ${timeoutMs / 1000}s on ${side}` };
  if (!existsSync(out)) return { statuses: new Map(), problem: `${runner} did not run on ${side} (exit ${r.status}): ${lastLine(r.stderr || r.stdout)}` };
  const report = JSON.parse(readFileSync(out, 'utf8')) as {
    testResults: { name: string; status?: string; message?: string; assertionResults: { ancestorTitles: string[]; title: string; status: string }[] }[];
  };
  const byName = new Map<string, string[]>();
  const brokenFiles = new Set<string>();
  for (const file of report.testResults) {
    const rel = file.name.replace(/\\/g, '/');
    if (file.assertionResults.length === 0 && file.status === 'failed') brokenFiles.add(rel);
    for (const a of file.assertionResults) {
      const name = [...a.ancestorTitles, a.title].join(' > ');
      byName.set(`${rel}\0${name}`, [...(byName.get(`${rel}\0${name}`) ?? []), a.status]);
    }
  }
  const statuses = new Map<string, F2pStatus>();
  const rows = new Map<string, string[] | null>();
  const inFile = (k: string, file: string): boolean => k.startsWith(`${file}\0`) || k.includes(`/${file}\0`);
  for (const t of targets) {
    const broken = [...brokenFiles].some((f) => f.endsWith(`/${t.file}`));
    if (t.table) {
      // One entry per row; a title seen twice cannot be told apart.
      const re = new RegExp(`^${namePattern(t, ' > ')}$`);
      const matched = [...byName].filter(([k]) => inFile(k, t.file) && re.test(k.slice(k.indexOf('\0') + 1)));
      const ambiguous = matched.some(([, v]) => v.length > 1);
      statuses.set(key(t), broken ? 'error' : ambiguous ? 'missing' : aggregate(matched.map(([, v]) => v[0]!)));
      rows.set(key(t), ambiguous ? null : matched.map(([k]) => k.slice(k.indexOf('\0') + 1)).sort());
      continue;
    }
    const found = [...byName].filter(([k]) => k.endsWith(`/${t.file}\0${t.name}`) || k === `${t.file}\0${t.name}`).flatMap(([, v]) => v);
    let status: F2pStatus = broken ? 'error' : 'missing';
    if (found.length === 1) status = found[0] === 'passed' ? 'passed' : found[0] === 'failed' ? 'failed' : 'skipped';
    else if (found.length > 1) status = 'missing'; // two tests with the same name: cannot tell them apart
    statuses.set(key(t), status);
  }
  return { statuses, rows, problem: null };
}

function lastLine(text: string): string {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  return (lines[lines.length - 1] ?? '').slice(0, 200);
}

/** Runs `targets` (head test ids) on base (with the head test files copied in) and on head. */
export function runF2p(repoDir: string, base: string, head: string, targets: F2pTarget[], timeoutMs: number): F2pResult {
  const work = mkdtempSync(join(tmpdir(), 'saidvsdid-f2p-'));
  const trees = { base: join(work, 'base'), head: join(work, 'head') };
  const added: string[] = [];
  try {
    for (const side of ['base', 'head'] as const) {
      git(repoDir, ['worktree', 'add', '--detach', '--quiet', trees[side], side === 'base' ? base : head]);
      added.push(trees[side]);
    }
    for (const file of new Set(targets.map((t) => t.file))) {
      const source = readBlob(repoDir, head, file);
      if (source === null) return { ok: false, reason: `${file} is not in head` };
      mkdirSync(dirname(join(trees.base, file)), { recursive: true });
      writeFileSync(join(trees.base, file), source);
    }
    const pkgText = readBlob(repoDir, head, 'package.json');
    const pkg = pkgText ? (JSON.parse(pkgText) as Record<string, unknown>) : null;
    const groups = new Map<Runner, F2pTarget[]>();
    for (const t of targets) {
      const runner = runnerFor(t.file, readBlob(repoDir, head, t.file), pkg);
      if (runner !== 'vitest' && runner !== 'jest' && runner !== 'pytest') return { ok: false, reason: runner };
      groups.set(runner, [...(groups.get(runner) ?? []), t]);
    }
    if (groups.has('vitest') || groups.has('jest')) {
      if (!existsSync(join(repoDir, 'node_modules'))) return { ok: false, reason: 'node_modules is missing: install the dependencies first' };
      linkNodeModules(repoDir, trees.base);
      linkNodeModules(repoDir, trees.head);
    }
    const result = { base: new Map<string, F2pStatus>(), head: new Map<string, F2pStatus>() };
    for (const [runner, group] of groups) {
      const rows: Record<'base' | 'head', Map<string, string[] | null> | undefined> = { base: undefined, head: undefined };
      for (const side of ['base', 'head'] as const) {
        const run = runner === 'pytest' ? runPytest(trees[side], group, work, side, timeoutMs) : runJs(runner, trees[side], group, work, side, timeoutMs);
        if (run.problem) return { ok: false, reason: run.problem };
        for (const [k, v] of run.statuses) result[side].set(k, v);
        rows[side] = run.rows;
      }
      // A parametrised test is compared row by row only when both sides report
      // the same, distinguishable rows; otherwise it is not verifiable.
      for (const t of group.filter((x) => x.table)) {
        const b = rows.base?.get(key(t));
        const h = rows.head?.get(key(t));
        if (!b || !h || b.length === 0 || JSON.stringify(b) !== JSON.stringify(h)) {
          result.base.set(key(t), 'missing');
          result.head.set(key(t), 'missing');
        }
      }
    }
    return { ok: true, ...result };
  } finally {
    for (const tree of added) {
      unlinkNodeModules(tree);
      try {
        git(repoDir, ['worktree', 'remove', '--force', tree]);
      } catch {
        // removed below; prune forgets it
      }
    }
    rmSync(work, { recursive: true, force: true });
    if (added.length) {
      try {
        execFileSync('git', ['worktree', 'prune'], { cwd: repoDir, stdio: 'ignore' });
      } catch {
        // best effort
      }
    }
  }
}

export const f2pKey = key;
