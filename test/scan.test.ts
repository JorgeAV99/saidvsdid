// bench/scan-history.mjs: aggregate TG006 statistics over a session history,
// with counts and session ids only.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CASES_DIR, SESSIONS_DIR } from '../fixtures/build.js';
import { renderScan, scanHistory } from '../src/scan.js';

const home = mkdtempSync(join(tmpdir(), 'saidvsdid-scan-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const claude = join(home, '.claude', 'projects');
const codex = join(home, '.codex', 'sessions');
const project = join(claude, 'C--work-toy');
mkdirSync(join(project, 'abc', 'subagents'), { recursive: true });
for (const s of ['claude-honest', 'claude-impossible', 'claude-regression', 'claude-stale']) {
  copyFileSync(join(SESSIONS_DIR, s, 'interactive.jsonl'), join(project, `${s}.jsonl`));
}
copyFileSync(join(CASES_DIR, 'TG006', 'claude-no-run', 'transcript.jsonl'), join(project, 'no-run.jsonl'));
// A subagent's file is not a session of its own.
copyFileSync(join(CASES_DIR, 'TG006', 'claude-no-run', 'transcript.jsonl'), join(project, 'abc', 'subagents', 'agent-1.jsonl'));
mkdirSync(join(codex, '2026', '09', '29'), { recursive: true });
for (const s of ['codex-blocked-sandbox', 'codex-honest', 'codex-impossible', 'codex-regression', 'codex-stale']) {
  copyFileSync(join(SESSIONS_DIR, s, 'transcript.jsonl'), join(codex, '2026', '09', '29', `${s}.jsonl`));
}
copyFileSync(join(CASES_DIR, 'TG006', 'codex-last-run-failed', 'transcript.jsonl'), join(codex, 'last-run-failed.jsonl'));
// Codex's own session logs (rollouts): the same session as codex-honest, and one with a subagent.
copyFileSync(join(CASES_DIR, 'TG006', 'codex-rollout-honest', 'transcript.jsonl'), join(codex, '2026', '09', '29', 'rollout-honest.jsonl'));
copyFileSync(join(CASES_DIR, 'TG006', 'codex-rollout-subagent', 'transcript.jsonl'), join(codex, '2026', '09', '29', 'rollout-subagent.jsonl'));
// Something else entirely.
writeFileSync(join(codex, 'notes.jsonl'), '{"kind":"note"}\n');

describe('scanHistory', () => {
  const result = scanHistory({ claude, codex });

  it('counts sessions, claims and TG006 outcomes', () => {
    expect(result).toMatchObject({
      files: { claude: 5, codex: 9 },
      unsupported: 1,
      unreadable: 0,
      unrecognised: 0,
      opaque: 1,
      turns: 13,
      // Certain: only the canonical own-line claims (claude-no-run, codex-last-run-failed); the real messages are possible;
      // the two stale ones disclose that the tests were not run again.
      claims: { suite_certain: 2, suite_possible: 6, suite_disclosed: 2, tests_added: 1, regression_test_added: 5 },
      // Warnings for the reviewer, never FAIL or PASS. INFO consistent_unverified: claude-honest and claude-regression (piped runs
      // whose summaries are green), codex-honest's rollout.
      // WARN: codex-regression (`pytest; git diff`: git's status), the rollout with a subagent, and the Codex exec
      // streams of codex-honest and codex-stale: exec records no working directory, so their
      // runs are not placed in a repository and say nothing (a rollout records it); claude-stale, whose run
      // (`cd … && git ls-files && python -m pytest | tail`) is outside the closed grammar of a placed run;
      // codex-last-run-failed: "last visible test run failed".
      // claude-no-run: no test run visible.
      tg006: { warn: 7, info: 3 },
    });
    const id = (s: string): string => (JSON.parse(readFileSync(join(SESSIONS_DIR, s, 'transcript.jsonl'), 'utf8').split('\n')[0]!) as Record<string, string>)['thread_id'] ?? '';
    // The exec stream and the rollout of one session: the rollout, which records its working directory, is consistent.
    expect(result.tg006.sessions.info.filter((s) => s === id('codex-honest'))).toHaveLength(1);
    expect(result.tg006.sessions.info).toHaveLength(3);
    expect(result.tg006.sessions.warn).toContain(id('codex-impossible'));
    expect(result.tg006.warnReasons['last_run_failed']).toBe(1);
    expect(result.tg006.warnReasons['no_test_run']).toBe(1);
    // Every warned session: the three Codex exec streams with runs, codex-regression (`pytest; git diff`, a chain outside
    // the grammar of a placed run) and claude-stale.
    expect(result.tg006.warnReasons['unplaced_run']).toBe(5);
  });

  it('prints no session content: only counts and ids', () => {
    const text = renderScan(result) + JSON.stringify(result);
    for (const leak of ['median', 'word_count', '<REPO>', 'npm', 'pytest', 'All 6 tests pass', 'src/']) expect(text).not.toContain(leak);
  });
});
