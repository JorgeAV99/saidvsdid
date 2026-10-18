// The CI job `guarantee matrix (full)` fails closed (.github/workflows/full-ci.yml): its path filter
// (scripts/guarantee-matrix-paths.mjs) runs the matrix unless every changed path is in its exclusion list, and
// whenever the answer is not certain,
// and its shards prove they ran the whole matrix (scripts/guarantee-matrix.ts, `verifyShards`): none empty, every
// one reported once, the cases adding up to what the generator counts.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decide, DOCS, excluded, EXCLUDED, NOT_EXCLUDED, RUNNER_EVIDENCE } from '../scripts/guarantee-matrix-paths.mjs';
import { countCases, verifyShards, type ShardReport } from './guarantee-matrix.js';

const ROOT = resolve(__dirname, '..');

describe('the path filter fails closed', () => {
  const work = mkdtempSync(join(tmpdir(), 'saidvsdid-paths-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: work, encoding: 'utf8' }).trim();
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), text);
  };
  /** A commit on top of `from` that `change` makes; its sha. */
  const commit = (from: string, change: () => void): string => {
    git('checkout', '-q', '--detach', from);
    change();
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'change');
    return git('rev-parse', 'HEAD');
  };
  let base = '';

  beforeAll(() => {
    git('init', '-q');
    write('src/parse/normalise.ts', 'export const x = 1;\n'.repeat(20));
    write('docs/notes.md', 'notes\n');
    write('README.md', 'readme\n');
    write('LICENSE', 'license\n');
    write('grammars/tree-sitter-python.wasm', '\0asm\u0001\0\0\0');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'base');
    base = git('rev-parse', 'HEAD');
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('a watched file renamed out of the watched paths runs (both paths, no rename detection)', () => {
    const head = commit(base, () => {
      mkdirSync(join(work, 'archive'), { recursive: true });
      renameSync(join(work, 'src/parse/normalise.ts'), join(work, 'archive/normalise.ts'));
    });
    const d = decide(base, head, work);
    expect(d.paths.sort()).toEqual(['archive/normalise.ts', 'src/parse/normalise.ts']);
    expect(d.run).toBe(true);
  });

  it('a name outside ASCII is read as it is, never quoted', () => {
    const head = commit(base, () => write('src/parse/ñ.ts', 'export {};\n'));
    const d = decide(base, head, work);
    expect(d.paths).toEqual(['src/parse/ñ.ts']);
    expect(d.run).toBe(true);
  });

  it('only the exclusion list skips it: what the matrix never reads, and never its own workflow', () => {
    expect(EXCLUDED).toEqual(['docs/**', '*.md', 'LICENSE', 'bench/**', 'fixtures/**', 'scripts/runner-evidence*', 'scripts/recorder-*', '.github/**', 'test/**']);
    expect(NOT_EXCLUDED).toEqual(['.github/workflows/full-ci.yml', 'test/guarantee-matrix.ts']);
    for (const p of [
      'docs/rules.md', 'docs/design/silence-net-v2.md', 'README.md', 'CLAUDE.md', 'LICENSE', '.github/ISSUE_TEMPLATE/bug.md',
      'bench/scan-history.mjs', 'bench/toy/overlays/impossible/py-pytest/tests/test_contract.py', 'fixtures/cases/TG001/x/case.json',
      'fixtures/oracle.ts', 'fixtures/cases/x/README.md', 'scripts/runner-evidence.mjs', 'scripts/recorder-readers.mjs',
      'scripts/recorder-readers.d.mts', '.github/workflows/ci.yml', '.github/workflows/monthly.yml', '.github/requirements-ci.txt',
      // The suite's tests: the matrix job never runs them (its slice, test/silence-guarantee.test.ts, is the suite's).
      'test/privacy.test.ts', 'test/silence-guarantee.test.ts', 'test/guarantee-matrix-ci.test.ts', 'test/support/python.ts',
    ]) expect(excluded(p), p).toBe(true);
    for (const p of [
      // The analyser, its interpreter-side reader, its grammars, its dependencies, and the matrix's scripts, tests and workflow.
      'src/check.ts', 'src/parse/vocabulary.ts', 'src/rules/guarantee.ts', 'src/README.md', 'python/saidvsdid_scopes.py',
      'grammars/tree-sitter-python.wasm', 'grammars/manifest.json', 'package.json', 'package-lock.json', 'tsconfig.json',
      'scripts/guarantee-matrix.ts', 'scripts/guarantee-matrix-paths.mjs', 'scripts/guarantee-matrix-paths.d.mts',
      'test/guarantee-matrix.ts', '.github/workflows/full-ci.yml', 'tests/a.ts', 'Test/guarantee-matrix.ts', 'testx/a.ts', 'test',
      // Near misses: a pattern matches whole components, case included.
      'tools/new.sh', 'LICENSE.txt', 'license', 'docs', 'docsx/a.md', 'Docs/a.md', '.md', 'bench', 'benchx/a', 'fixtures', 'Fixtures/a',
      'fixturesx/a', '.github', '.githubx/a', '.GitHub/workflows/ci.yml', 'scripts/runner-evidence', 'scripts/recorder-',
      'scripts/sub/runner-evidence.mjs', 'scripts/runner-evidence/x.mjs', 'Scripts/recorder-readers.mjs', 'src/fixtures/a.ts',
    ]) expect(excluded(p), p).toBe(false);
  });

  it('nothing the matrix reads is excluded: its import closure, the Python reader, the grammars, package.json', () => {
    // The matrix runs scripts/guarantee-matrix.ts with test/guarantee-matrix.ts; every module they import, transitively.
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const m of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const spec = resolve(dirname(file), m[1]!);
        const found = [spec, spec.replace(/\.js$/, '.ts'), `${spec}.ts`].find((c) => existsSync(c) && c !== dirname(c) && !c.endsWith('/'));
        expect(found, `${relative(ROOT, file)} imports ${m[1]}`).toBeDefined();
        walk(found!);
      }
    };
    walk(join(ROOT, 'scripts', 'guarantee-matrix.ts'));
    walk(join(ROOT, 'test', 'guarantee-matrix.ts'));
    const read = [...seen].map((f) => relative(ROOT, f).split('\\').join('/'));
    expect(read.filter((p) => p.startsWith('src/')).length).toBeGreaterThan(20);
    read.push('python/saidvsdid_scopes.py', 'package.json', 'package-lock.json', ...readdirSync(join(ROOT, 'grammars')).map((g) => `grammars/${g}`));
    expect(read.filter((p) => excluded(p))).toEqual([]);
  });

  it('the fixtures against the real runners: skipped only when every path is one the recorder never reads', () => {
    expect(RUNNER_EVIDENCE).toEqual(['docs/**', '*.md', 'LICENSE', '.github/ISSUE_TEMPLATE/**', 'bench/**', 'src/**', 'python/**', 'grammars/**', 'test/**']);
    for (const p of ['src/check.ts', 'python/saidvsdid_scopes.py', 'grammars/tree-sitter-python.wasm', 'test/privacy.test.ts', 'bench/README.md', 'docs/rules.md', 'README.md', 'LICENSE']) {
      expect(excluded(p, RUNNER_EVIDENCE), p).toBe(true);
    }
    for (const p of [
      // What it reads: the fixtures, its own script and readers, the runners (node_modules from package*.json, the pytest
      // pin), the workflow that sets Node and Python, and every root-level file a runner may find walking up from
      // fixtures/.runner/<case>/<side> (package.json, tsconfig.json, conftest.py, pytest.ini, a babel or jest config…).
      'fixtures/cases/TG001/x/case.json', 'fixtures/oracle.ts', 'scripts/runner-evidence.mjs', 'scripts/recorder-readers.mjs',
      'package.json', 'package-lock.json', '.github/requirements-ci.txt', '.github/workflows/full-ci.yml', 'tsconfig.json',
      'conftest.py', 'pytest.ini', 'pyproject.toml', 'setup.cfg', 'tox.ini', 'babel.config.js', 'jest.config.js', 'vitest.config.ts',
      '.gitignore', 'test-results/.last-run.json', 'scripts/guarantee-matrix.ts', 'tools/new.sh', 'srcx/a.ts', 'Src/a.ts',
    ]) expect(excluded(p, RUNNER_EVIDENCE), p).toBe(false);
  });

  it('nothing the recorder reads is excluded from its scope: its imports, and every ancestor of where the runners run', () => {
    const script = join(ROOT, 'scripts', 'runner-evidence.mjs');
    const text = readFileSync(script, 'utf8');
    const imports = [...text.matchAll(/^import .* from '(\.{1,2}\/[^']+)';$/gm)].map((m) => relative(ROOT, resolve(dirname(script), m[1]!)).split('\\').join('/'));
    expect(imports).toEqual(['scripts/recorder-readers.mjs']);
    expect(readFileSync(join(ROOT, 'scripts', 'recorder-readers.mjs'), 'utf8')).not.toMatch(/^import .* from '\./m);
    // The runners run in fixtures/.runner/<case>/<side> (or SAIDVSDID_RUNNER_WORK): its ancestors are fixtures/ and the root.
    expect(text).toContain("join(ROOT, 'fixtures', '.runner')");
    for (const p of ['scripts/runner-evidence.mjs', ...imports, 'fixtures/.runner/TG001/x/base/package.json', 'fixtures/package.json', 'fixtures/conftest.py']) {
      expect(excluded(p, RUNNER_EVIDENCE), p).toBe(false);
    }
    // Every root-level name it could find walking up is read unless it is Markdown or LICENSE.
    expect(RUNNER_EVIDENCE.filter((x) => !x.includes('/'))).toEqual(['*.md', 'LICENSE']);
  });

  it('--runner-evidence: the analyser and its tests alone skip it; a fixture or the lockfile runs it', () => {
    const analyser = commit(base, () => {
      write('src/parse/normalise.ts', 'export const z = 3;\n');
      write('test/a.test.ts', 'test\n');
    });
    expect(decide(base, analyser, work, RUNNER_EVIDENCE).run).toBe(false);
    expect(decide(base, analyser, work).run).toBe(true);
    for (const path of ['fixtures/cases/TG001/x/case.json', 'package-lock.json', 'scripts/recorder-readers.mjs', 'tsconfig.json']) {
      const head = commit(base, () => {
        write('src/parse/normalise.ts', 'export const z = 4;\n');
        write(path, 'changed\n');
      });
      expect(decide(base, head, work, RUNNER_EVIDENCE).run, path).toBe(true);
    }
    const dir = mkdtempSync(join(tmpdir(), 'saidvsdid-paths-out-'));
    const out = join(dir, 'github-output');
    writeFileSync(out, '');
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'guarantee-matrix-paths.mjs'), '--runner-evidence', base, analyser], { cwd: work, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out } });
    expect(r.status).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe('run=false\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('a change of tests outside the matrix alone skips it; its own test file runs it', () => {
    const tests = commit(base, () => write('test/privacy.test.ts', 'test\n'));
    expect(decide(base, tests, work).run).toBe(false);
    const own = commit(base, () => write('test/guarantee-matrix.ts', 'export {};\n'));
    expect(decide(base, own, work).run).toBe(true);
  });

  it('documentation alone, for the platform jobs: docs/**, *.md at the root, LICENSE, .github/ISSUE_TEMPLATE/**', () => {
    expect(DOCS).toEqual(['docs/**', '*.md', 'LICENSE', '.github/ISSUE_TEMPLATE/**']);
    for (const p of ['docs/rules.md', 'README.md', 'LICENSE', '.github/ISSUE_TEMPLATE/bug.md']) expect(excluded(p, DOCS), p).toBe(true);
    for (const p of ['fixtures/cases/x/README.md', 'bench/README.md', 'scripts/runner-evidence.mjs', '.github/workflows/ci.yml', 'src/check.ts']) expect(excluded(p, DOCS), p).toBe(false);
  });

  it('a change of fixtures, bench or the recorder alone skips the matrix, but not the documentation-only scope', () => {
    const head = commit(base, () => {
      write('fixtures/cases/TG001/x/case.json', '{}\n');
      write('scripts/recorder-readers.mjs', 'export {};\n');
      write('bench/README.md', 'b\n');
    });
    expect(decide(base, head, work).run).toBe(false);
    expect(decide(base, head, work, DOCS).run).toBe(true);
  });

  it('the matrix\'s own workflow, or the analyser, with excluded paths: it runs', () => {
    for (const path of ['.github/workflows/full-ci.yml', 'src/parse/normalise.ts', 'python/saidvsdid_scopes.py', 'package-lock.json', 'test/guarantee-matrix.ts']) {
      const head = commit(base, () => {
        write('.github/workflows/ci.yml', 'name: CI\n');
        write(path, 'changed\n');
      });
      expect(decide(base, head, work).run, path).toBe(true);
    }
  });

  it('--docs: the script decides for documentation alone', () => {
    const head = commit(base, () => write('fixtures/cases/TG001/x/case.json', '{"x":1}\n'));
    // Outside the repository: a file left in it would be part of the next test's commit.
    const dir = mkdtempSync(join(tmpdir(), 'saidvsdid-paths-out-'));
    const out = join(dir, 'github-output');
    writeFileSync(out, '');
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'guarantee-matrix-paths.mjs'), '--docs', base, head], { cwd: work, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out } });
    expect(r.status).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe('run=true\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('a grammar renamed runs: both paths, neither excluded', () => {
    const head = commit(base, () => renameSync(join(work, 'grammars/tree-sitter-python.wasm'), join(work, 'grammars/python.wasm')));
    const d = decide(base, head, work);
    expect(d.paths.sort()).toEqual(['grammars/python.wasm', 'grammars/tree-sitter-python.wasm']);
    expect(d.run).toBe(true);
  });

  it('a new file at a path the list does not know runs', () => {
    const head = commit(base, () => write('tools/new.sh', 'echo\n'));
    expect(decide(base, head, work)).toMatchObject({ run: true, paths: ['tools/new.sh'] });
  });

  it('only excluded paths changed: it does not run', () => {
    const head = commit(base, () => {
      write('docs/notes.md', 'more notes\n');
      write('README.md', 'more\n');
      write('LICENSE', 'more\n');
    });
    expect(decide(base, head, work)).toMatchObject({ run: false });
    expect(decide(base, head, work).paths.sort()).toEqual(['LICENSE', 'README.md', 'docs/notes.md']);
  });

  it('an excluded path with one that is not runs', () => {
    const head = commit(base, () => {
      write('docs/notes.md', 'more notes\n');
      write('src/parse/normalise.ts', 'export const y = 2;\n');
    });
    expect(decide(base, head, work).run).toBe(true);
  });

  it('in doubt it runs: git fails, or no path is read', () => {
    expect(decide('no-such-ref', 'HEAD', work).run).toBe(true);
    expect(decide(base, base, work)).toMatchObject({ run: true, paths: [] });
    expect(decide(base, base, join(work, 'not-a-repo')).run).toBe(true);
  });

  it('the script itself writes run=true on any error (no arguments)', () => {
    const out = join(work, 'github-output');
    writeFileSync(out, '');
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'guarantee-matrix-paths.mjs')], { cwd: work, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out } });
    expect(r.status).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe('run=true\n');
  });
});

describe('the shards fail closed', () => {
  const shards = 8;
  const total = 1000;
  const reports = (cases: number[]): ShardReport[] => cases.map((n, shard) => ({ mode: 'full', shard, shards, cases: n, failures: 0 }));
  const even = [125, 125, 125, 125, 125, 125, 125, 125];

  it('every shard once, none empty, none failing, adding up to the total: no problem', () => {
    expect(verifyShards(reports(even), { mode: 'full', shards, total })).toEqual([]);
  });

  it('Codex\'s injection: shard 0 runs nothing', () => {
    const problems = verifyShards(reports([0, ...even.slice(1)]), { mode: 'full', shards, total });
    expect(problems).toContain('shard 0: ran 0 cases');
    expect(problems).toContain('the shards ran 875 cases, the matrix has 1000');
  });

  it('a missing, a repeated, a failing or a foreign shard, or a sum that does not add up', () => {
    expect(verifyShards(reports(even).slice(1), { mode: 'full', shards, total })).toContain('shard 0: reported 0 times');
    expect(verifyShards([...reports(even), reports(even)[3]!], { mode: 'full', shards, total })).toContain('shard 3: reported 2 times');
    expect(verifyShards(reports(even).map((r) => (r.shard === 5 ? { ...r, failures: 2 } : r)), { mode: 'full', shards, total })).toContain('shard 5: 2 cases failing');
    expect(verifyShards(reports(even).map((r) => (r.shard === 2 ? { ...r, mode: 'suite' as const } : r)), { mode: 'full', shards, total }).length).toBeGreaterThan(0);
    expect(verifyShards(reports([126, ...even.slice(1)]), { mode: 'full', shards, total })).toContain('the shards ran 1001 cases, the matrix has 1000');
  });

  // The real runner, spawned (node and tsx's CLI: the same on every platform), in the hook under its own limit.
  const script = join(ROOT, 'scripts', 'guarantee-matrix.ts');
  const tsx = (...args: string[]): ReturnType<typeof spawnSync> => spawnSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), script, ...args], { cwd: ROOT, encoding: 'utf8' });
  const ran: Record<'empty' | 'whole' | 'injected', ReturnType<typeof spawnSync> | null> = { empty: null, whole: null, injected: null };
  beforeAll(() => {
    // A shard past the last case: the real runner, empty.
    ran.empty = tsx('--mode', 'suite', '--shard', '999999', '--shards', '1000000');
    // The reports of 8 shards that add up to the suite's count pass; with shard 0 emptied (Codex's injection), they fail.
    const n = countCases('suite');
    const split = Array.from({ length: shards }, (_, s) => Math.floor(n / shards) + (s < n % shards ? 1 : 0));
    const dir = mkdtempSync(join(tmpdir(), 'saidvsdid-shards-'));
    const verify = (cases: number[]): ReturnType<typeof spawnSync> => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir);
      cases.forEach((c, s) => writeFileSync(join(dir, `shard-${s}.json`), JSON.stringify({ mode: 'suite', shard: s, shards, cases: c, failures: 0 })));
      return tsx('--verify', dir, '--shards', String(shards), '--mode', 'suite');
    };
    ran.whole = verify(split);
    ran.injected = verify([0, ...split.slice(1)]);
    rmSync(dir, { recursive: true, force: true });
  }, 600_000);

  it('the runner fails on a shard that runs no case', () => {
    expect(ran.empty?.status, String(ran.empty?.stdout) + String(ran.empty?.stderr)).toBe(1);
    expect(String(ran.empty?.stderr)).toContain('ran no case');
  });

  it('--verify passes the shards that add up to the generator\'s count, and fails Codex\'s injection', () => {
    expect(ran.whole?.status, String(ran.whole?.stderr)).toBe(0);
    expect(ran.injected?.status).toBe(1);
    expect(String(ran.injected?.stderr)).toContain('shard 0: ran 0 cases');
    expect(String(ran.injected?.stderr)).toMatch(/the shards ran \d+ cases, the matrix has \d+/);
  });
});
