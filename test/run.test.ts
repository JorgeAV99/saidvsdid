// `saidvsdid run`: what ties a recorded run to the code. tree_sha is the
// working copy's tree; repo.head is a commit only when the working copy is
// exactly that commit's tree (an uncommitted change is not HEAD's code).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runWrapped } from '../src/run.js';

const dir = mkdtempSync(join(tmpdir(), 'saidvsdid-run-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const git = (...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' }).trim();
const io = { stdout: () => {}, stderr: () => {}, cwd: dir };

describe('saidvsdid run: repo.head and tree_sha', () => {
  it('a clean working copy is HEAD: both recorded', async () => {
    git('init', '-q');
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'a');
    const { evidence } = await runWrapped(['node', '--version'], io);
    expect(evidence.repo.head).toBe(git('rev-parse', 'HEAD'));
    expect(evidence.runs[0]!.tree_sha).toBe(git('rev-parse', 'HEAD^{tree}'));
  });

  it('an uncommitted change is not HEAD: repo.head null, tree_sha the working copy', async () => {
    writeFileSync(join(dir, 'a.txt'), 'changed\n');
    const { evidence } = await runWrapped(['node', '--version'], io);
    expect(evidence.repo.head).toBeNull();
    expect(evidence.runs[0]!.tree_sha).not.toBe(git('rev-parse', 'HEAD^{tree}'));
    // Committed afterwards with that tree: the run is tied to the new commit through its tree.
    git('add', '-A');
    git('commit', '-q', '-m', 'b');
    expect(evidence.runs[0]!.tree_sha).toBe(git('rev-parse', 'HEAD^{tree}'));
  });
});
