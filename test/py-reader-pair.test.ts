// The two sides of a file are read in the same call and judged together (Codex, review of the commit that sent the Python scope reader's stderr to a file and capped its calls at 1 MB): when the Python
// scope reader fails on the base or the head of a file, the file is one WARN `scope_unavailable` and nothing in it is
// a FAIL, whichever side failed and however the run was split into calls. Real Python processes: the scope reader's
// calls run `python -I -X utf8 wrapper.py saidvsdid_scopes.py`, and the wrapper ends with exit 7, as a reader that dies
// would, when the request holds a file marked `# reader-exits-7`; any other request goes to the real script.
import type * as ChildProcess from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ wrapper: '', calls: 0 }));

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof ChildProcess>();
  const spawnSync = ((command: string, args: readonly string[], options: object) => {
    const script = args?.findIndex((a) => String(a).endsWith('saidvsdid_scopes.py')) ?? -1;
    if (script < 0) return real.spawnSync(command, args, options as never);
    state.calls++;
    return real.spawnSync(command, [...args.slice(0, script), state.wrapper, ...args.slice(script)], options as never);
  }) as typeof real.spawnSync;
  return { ...real, default: { ...real, spawnSync }, spawnSync };
});

state.wrapper = join(mkdtempSync(join(tmpdir(), 'saidvsdid-wrapper-')), 'wrapper.py');
writeFileSync(
  state.wrapper,
  [
    'import base64, io, json, runpy, sys',
    'raw = sys.stdin.buffer.read()',
    "if any(b'# reader-exits-7' in base64.b64decode(f['source']) for f in json.loads(raw)['files']):",
    "    sys.stderr.write('the reader died\\n')",
    '    sys.exit(7)',
    'sys.stdin = io.TextIOWrapper(io.BytesIO(raw))',
    'sys.argv = sys.argv[1:]',
    "runpy.run_path(sys.argv[0], run_name='__main__')",
    '',
  ].join('\n'),
);

const { analyze } = await import('../src/check.js');
const { CALL_BYTES, pythonFacts, splitCalls } = await import('../src/parse/py-scopes.js');

/** About `kb` KB of comments: the size of a side, so that base and head together exceed one call. */
const pad = (kb: number): string => `# ${'x'.repeat(60)}\n`.repeat(Math.ceil((kb * 1000) / 63));

/** A certain skip added at head: a FAIL when the reader reads both sides. `dies` marks the side whose call ends with exit 7. */
function sides(tag: string, kb: number, dies: 'base' | 'head' | null): { base: string; head: string } {
  const mark = (side: 'base' | 'head') => `# ${tag}\n${dies === side ? '# reader-exits-7\n' : ''}`;
  const body = `import pytest\n\n\ndef test_t():\n`;
  return {
    base: `${mark('base')}${pad(kb)}${body}    assert 1 == 1\n`,
    head: `${mark('head')}${pad(kb)}${body}    pytest.skip("x")\n    assert 1 == 1\n`,
  };
}

function check({ base, head }: { base: string; head: string }) {
  return analyze({
    base: '0'.repeat(40),
    head: '1'.repeat(40),
    changes: [{ status: 'M', basePath: 'test_a.py', headPath: 'test_a.py' }],
    read: (side, path) => (path === 'test_a.py' ? (side === 'base' ? base : head) : null),
  });
}

type Report = Awaited<ReturnType<typeof analyze>>;

function expectOnlyWarn(report: Report, side: 'base' | 'head') {
  expect(report.findings.filter((f) => f.severity === 'fail')).toEqual([]);
  expect(report.verdict).toBe('WARN');
  const unavailable = report.findings.filter((f) => f.reason === 'scope_unavailable');
  expect(unavailable.map((f) => [f.file, f.side])).toEqual([['test_a.py', side]]);
  expect(unavailable[0]!.message).toMatch(/exit 7: the reader died/);
}

describe('base and head of a file are read in the same call', () => {
  it('a pair goes into one call; a pair larger than a call goes alone, and the files around it keep their calls', () => {
    const f = (n: number) => ({ source: new Uint8Array(n) });
    const sizes = (calls: Array<Array<{ source: Uint8Array }>>) => calls.map((c) => c.map((x) => x.source.length));
    expect(sizes(splitCalls([[f(600_000), f(600_001)], [f(10)], [f(400_000), f(300_000)], [f(2)]]))).toEqual([
      [600_000, 600_001],
      [10, 400_000, 300_000, 2],
    ]);
    for (const call of splitCalls([[f(300_000)], [f(400_000), f(400_000)], [f(1)]])) {
      if (call.length > 1) expect(call.reduce((n, x) => n + x.source.length, 0)).toBeLessThanOrEqual(CALL_BYTES);
    }
  });
});

describe('the reader fails on one side of a file (real Python processes)', () => {
  it('control: both sides answer, and the certain skip is a FAIL', async () => {
    const report = await check(sides('control', 600, null));
    expect(report.verdict).toBe('FAIL');
    expect(report.findings.some((f) => f.reason === 'scope_unavailable')).toBe(false);
  }, 120_000);

  it('Codex: base and head of about 600 KB each, base\'s reader ends with exit 7 → one WARN, no FAIL', async () => {
    expectOnlyWarn(await check(sides('codex', 600, 'base')), 'base');
  }, 120_000);

  it('the inverse: head\'s side makes the reader end with exit 7 → one WARN, no FAIL', async () => {
    // Both sides are in the call that ended: neither is read, and the WARN names the first, base.
    expectOnlyWarn(await check(sides('inverse', 600, 'head')), 'base');
  }, 120_000);

  // The invariant does not depend on how a run is split: one side read earlier (cached by content), the other failing now.
  it.each(['base', 'head'] as const)('the %s side fails while the other side was read in an earlier call → one WARN, no FAIL', async (dies) => {
    const pair = sides(`earlier-${dies}`, 1, dies);
    const other = dies === 'base' ? pair.head : pair.base;
    expect(pythonFacts(new TextEncoder().encode(other))).toMatchObject({ ok: true });
    expectOnlyWarn(await check(pair), dies);
  }, 120_000);
});
