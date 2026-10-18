// When the Python scope reader fails on a call — it never ends (both limits fire: `spawnSync python3
// ETIMEDOUT`, seen on macOS CI), or spawning it throws — every Python file of the call gets one
// file-level WARN `scope_unavailable`, and nothing in it is certainly the runner's: never OK, never a FAIL. A
// first timeout is tried once more, and a second attempt that answers is read as usual. The reader is replaced
// here by a stand-in for `spawnSync` (vitest's module mock, this file only); the empty batch that looks for the
// interpreter, and the control, go to the real one.
import type * as ChildProcess from 'node:child_process';
import { fstatSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

type Mode = 'real' | 'timeout' | 'timeout-once' | 'throws';
const state = vi.hoisted(() => ({ mode: 'real' as Mode, attempts: 0, calls: [] as Array<{ input: boolean; stdio: unknown[]; timeout: unknown }> }));

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof ChildProcess>();
  const spawnSync = ((command: string, args: readonly string[], options: { input?: unknown; stdio?: unknown[] }) => {
    if (!args?.some((a) => String(a).endsWith('saidvsdid_scopes.py'))) return real.spawnSync(command, args, options as never);
    const stdin = options.stdio?.[0];
    state.calls.push({ input: options.input !== undefined, stdio: options.stdio ?? [], timeout: (options as { timeout?: unknown }).timeout });
    // The interpreter is looked for with an empty batch ({"files":[]}): always the real reader.
    const empty = typeof stdin === 'number' && fstatSync(stdin).size <= '{"files":[]}'.length;
    if (state.mode === 'real' || empty) return real.spawnSync(command, args, options as never);
    state.attempts++;
    if (state.mode === 'throws') throw new Error('spawn EAGAIN');
    if (state.mode === 'timeout-once' && state.attempts > 1) return real.spawnSync(command, args, options as never);
    const error = Object.assign(new Error(`spawnSync ${command} ETIMEDOUT`), { code: 'ETIMEDOUT' });
    return { pid: 0, output: [null, null, Buffer.alloc(0)], stdout: null, stderr: Buffer.alloc(0), status: null, signal: 'SIGTERM', error };
  }) as typeof real.spawnSync;
  return { ...real, default: { ...real, spawnSync }, spawnSync };
});

const { analyze } = await import('../src/check.js');

/** A certain skip added at head (a FAIL when the reader answers); `tag` keeps each test's bytes apart (the reader caches by content). */
async function check(tag: string) {
  const base = `# ${tag}\nimport pytest\n\n\ndef test_t():\n    assert 1 == 1\n`;
  const head = `# ${tag}\nimport pytest\n\n\ndef test_t():\n    pytest.skip("x")\n    assert 1 == 1\n`;
  return analyze({
    base: '0'.repeat(40),
    head: '1'.repeat(40),
    changes: [{ status: 'M', basePath: 'test_a.py', headPath: 'test_a.py' }],
    read: (side, path) => (path === 'test_a.py' ? (side === 'base' ? base : head) : null),
  });
}

describe('the Python scope reader fails on a batch', () => {
  it('control: the real reader answers, and the certain skip is a FAIL', async () => {
    state.mode = 'real';
    const report = await check('control');
    expect(report.verdict).toBe('FAIL');
    expect(report.findings.some((f) => f.reason === 'scope_unavailable')).toBe(false);
  });

  it.each([
    ['it never ends (the timeout fires on both attempts)', 'timeout' as const, /ETIMEDOUT \(timed out twice, after 60 s and 300 s\)/],
    ['spawning it throws', 'throws' as const, /spawn EAGAIN/],
  ])('%s: one file-level WARN scope_unavailable, never OK, never a FAIL', async (_title, mode, said) => {
    state.mode = mode;
    state.attempts = 0;
    const report = await check(mode);
    // A timeout is tried once more; a spawn that throws is not.
    expect(state.attempts).toBe(mode === 'timeout' ? 2 : 1);
    expect(report.verdict).toBe('WARN');
    expect(report.findings.some((f) => f.severity === 'fail')).toBe(false);
    expect(report.findings.map((f) => [f.rule, f.severity, f.line, f.reason ?? null])).toEqual([
      ['TG003', 'warn', null, 'scope_unavailable'],
      ['TG003', 'warn', 6, null],
    ]);
    expect(report.findings[0]!.message).toMatch(said);
  });

  it('a first timeout is tried once more, and the second attempt is read as usual (the FAIL)', async () => {
    state.mode = 'timeout-once';
    state.attempts = 0;
    const report = await check('timeout-once');
    expect(state.attempts).toBe(2);
    expect(report.verdict).toBe('FAIL');
    expect(report.findings.some((f) => f.reason === 'scope_unavailable')).toBe(false);
  });

  it('the request, the reply and stderr are files, never pipes; a small call has 60 s, then 300 s', () => {
    expect(state.calls.length).toBeGreaterThan(0);
    for (const c of state.calls) {
      expect(c.input).toBe(false);
      expect(c.stdio.map((fd) => typeof fd)).toEqual(['number', 'number', 'number']);
      expect([60_000, 300_000]).toContain(c.timeout);
    }
    // The never-ending call: its first attempt has 60 s, its retry 300 s.
    expect(state.calls.some((c) => c.timeout === 300_000)).toBe(true);
  });
});
