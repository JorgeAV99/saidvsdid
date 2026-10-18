// `baseline` is the deliberately dumb rival: regular expressions over the
// diff. These tests pin its shape and its intended blind spots, and keep it
// from quietly borrowing the real analysis.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildFixtureRepo, CASES_DIR, listCases } from '../fixtures/build.js';
import { runBaseline } from '../src/baseline.js';
import { runCheck } from '../src/check.js';
import { main } from '../src/cli.js';
import { EXIT_CODES } from '../src/report/model.js';

const workdir = mkdtempSync(join(tmpdir(), 'saidvsdid-baseline-'));
// One git repository per case: removing them all is slow on Windows runners (as in fixtures.test.ts).
afterAll(() => rmSync(workdir, { recursive: true, force: true }), 120_000);

function repoFor(id: string): { repo: string; base: string; head: string } {
  const [rule, name] = id.split('/');
  return buildFixtureRepo(join(CASES_DIR, rule!, name!), join(workdir, id));
}

describe('baseline', () => {
  it.each(listCases().map((c) => c.id))('produces a check-shaped report with a consistent exit code: %s', (id) => {
    const r = runBaseline(repoFor(id));
    expect(r.schema).toBe('saidvsdid/report/v1');
    // No claims to verify: never a PASS, at best OK.
    expect(['OK', 'WARN', 'FAIL']).toContain(r.verdict);
    expect(r.exit_code).toBe(EXIT_CODES[r.verdict]);
  });

  it('catches the obvious cases', () => {
    expect(runBaseline(repoFor('TG001/deleted-test-file')).verdict).toBe('FAIL');
    expect(runBaseline(repoFor('TG002/it-only')).verdict).toBe('FAIL');
    expect(runBaseline(repoFor('TG003/it-skip-existing')).verdict).toBe('FAIL');
  });

  it('is fooled where a grep is fooled (by design)', async () => {
    // `.only` inside a comment or a string: a false alarm the AST avoids.
    const comment = repoFor('TG002/only-in-comment-or-string');
    expect(runBaseline(comment).verdict).toBe('FAIL');
    expect((await runCheck(comment)).verdict).toBe('OK');
    // Scope reduced in vitest.config.ts: not a test file, so invisible to it.
    const scope = repoFor('TG005/vitest-exclude-added');
    expect(runBaseline(scope).verdict).toBe('OK');
    expect((await runCheck(scope)).exit_code).not.toBe(0);
  });

  it('does not reuse the real analysis (no extractor, no safety net)', () => {
    const source = readFileSync(new URL('../src/baseline.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.filter((i) => /parse|net|scope|config|match|check/.test(i!))).toEqual([]);
  });

  it('is available from the CLI with the same formats and exit codes as check', async () => {
    const { repo } = repoFor('TG002/it-only');
    let out = '';
    const code = await main(['baseline', '--base', 'HEAD~1', '--format', 'json'], { stdout: (t) => (out += t), stderr: () => {}, cwd: repo });
    expect(code).toBe(2);
    expect(JSON.parse(out)).toMatchObject({ schema: 'saidvsdid/report/v1', verdict: 'FAIL', exit_code: 2 });
  });
});
