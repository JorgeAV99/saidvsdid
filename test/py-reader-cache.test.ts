// One reading per file and analysis (Codex, review of the commit that read the base and head of a file in one call of the Python scope reader): the Python scope reader's answers for a file's base
// and head are taken once, where src/check.ts puts them together; the invariant decides on those values and the rules
// read exactly them. The cache (by content, emptied when it holds CACHE_LIMIT files) may be emptied in the middle of an
// analysis, but it can no longer make a file's parsing read it again, nor change what was decided about it.
//
// Codex's reproduction, in one analysis, no concurrency: the target's head is cached beforehand; 4 096 files that
// declare Latin-1 come first, then the target pair (valid UTF-8). Base is read with the others; taking head's answer
// empties the cache; on the commit that read the base and head of a file in one call of the Python scope reader, the parsing then read base again, that process ended with exit 7, and the target had a
// FAIL (TG003) and a WARN scope_unavailable. Real Python processes: a read that "dies" is a real interpreter that
// reads its request and exits with 7.
import { createHash } from 'node:crypto';
import type * as ChildProcess from 'node:child_process';
import type * as ParseIndex from '../src/parse/index.js';
import { fstatSync, readFileSync, readSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

type Event = { kind: 'reader'; ids: string[] } | { kind: 'parse'; path: string };
const state = vi.hoisted(() => ({
  events: [] as Array<{ kind: 'reader'; ids: string[] } | { kind: 'parse'; path: string }>,
  /** The file (its key) whose n-th read, and later ones, end with exit 7; null: every read is real. */
  dies: null as null | { id: string; from: number },
  reads: new Map<string, number>(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof ChildProcess>();
  const spawnSync = ((command: string, args: readonly string[], options: { stdio?: unknown[] }) => {
    if (!args?.some((a) => String(a).endsWith('saidvsdid_scopes.py'))) return real.spawnSync(command, args, options as never);
    // The request, read without moving the descriptor's offset (the child reads it from the start).
    const fd = options.stdio?.[0] as number;
    const buf = Buffer.alloc(fstatSync(fd).size);
    readSync(fd, buf, 0, buf.length, 0);
    const ids = (JSON.parse(buf.toString('utf8')) as { files: Array<{ id: string }> }).files.map((f) => f.id);
    state.events.push({ kind: 'reader', ids });
    let dies = false;
    for (const id of ids) {
      const n = (state.reads.get(id) ?? 0) + 1;
      state.reads.set(id, n);
      if (state.dies && id === state.dies.id && n >= state.dies.from) dies = true;
    }
    if (dies) return real.spawnSync(command, ['-I', '-c', 'import sys; sys.stdin.buffer.read(); sys.exit(7)'], options as never);
    return real.spawnSync(command, args, options as never);
  }) as typeof real.spawnSync;
  return { ...real, default: { ...real, spawnSync }, spawnSync };
});

vi.mock('../src/parse/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof ParseIndex>();
  const parseTestFile: typeof real.parseTestFile = (path, source, options) => {
    state.events.push({ kind: 'parse', path });
    return real.parseTestFile(path, source, options);
  };
  return { ...real, parseTestFile };
});

const { analyze } = await import('../src/check.js');
const { pythonFacts } = await import('../src/parse/py-scopes.js');

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const keyOf = (s: string): string => createHash('sha256').update(enc(s)).digest('hex');
const TARGET = 'test_target.py';

/** A run like Codex's: `n` files declaring Latin-1, then the target pair (a certain skip added at head). */
function run(tag: string, n = 4096) {
  const latin = Array.from({ length: n }, (_, i) => `# -*- coding: latin-1 -*-\n# ${tag} ${i}\nimport pytest\n\n\ndef test_l():\n    assert True\n`);
  const base = `# ${tag}\nimport pytest\n\n\ndef test_t():\n    assert 1 == 1\n`;
  const head = `# ${tag}\nimport pytest\n\n\ndef test_t():\n    pytest.skip("x")\n    assert 1 == 1\n`;
  const files = new Map(latin.map((s, i) => [`test_l${i}.py`, s]));
  return {
    base,
    head,
    analyze: () =>
      analyze({
        base: '0'.repeat(40),
        head: '1'.repeat(40),
        changes: [
          ...[...files.keys()].map((p) => ({ status: 'A' as const, basePath: null, headPath: p })),
          { status: 'M' as const, basePath: TARGET, headPath: TARGET },
        ],
        read: (side, path) => (path === TARGET ? (side === 'base' ? base : head) : side === 'head' ? (files.get(path) ?? null) : null),
      }),
  };
}

type Report = Awaited<ReturnType<typeof analyze>>;
const onTarget = (report: Report) => report.findings.filter((f) => f.file === TARGET);

/** No file has both a FAIL and its WARN scope_unavailable: the invariant, on every file of the run. */
function expectInvariant(report: Report) {
  const unread = new Set(report.findings.filter((f) => f.reason === 'scope_unavailable').map((f) => f.file));
  expect(report.findings.filter((f) => f.severity === 'fail' && unread.has(f.file))).toEqual([]);
}

/** After the target's parsing starts, the reader is never asked about the target again (either side). */
function expectNoReadAfterParse(events: Event[], ids: string[]) {
  const start = events.findIndex((e) => e.kind === 'parse' && e.path === TARGET);
  expect(start).toBeGreaterThan(-1);
  const late = events.slice(start).filter((e) => e.kind === 'reader' && e.ids.some((id) => ids.includes(id)));
  expect(late).toEqual([]);
}

function prepare(tag: string, dies: 'base' | 'head' | null) {
  const r = run(tag);
  state.events = [];
  state.reads = new Map();
  // The target's head is in the cache before the analysis (its first read).
  expect(pythonFacts(enc(r.head))).toMatchObject({ ok: true });
  // Base's second read dies (on the commit that read the base and head of a file in one call of the Python scope reader: the parsing's), or head's second (the one the decision takes after the
  // cache was emptied).
  state.dies = dies === null ? null : { id: keyOf(dies === 'base' ? r.base : r.head), from: 2 };
  return r;
}

describe('the cache is emptied in the middle of an analysis (Codex, review of the commit that read the base and head of a file in one call of the Python scope reader)', () => {
  it('control: no read dies, and the certain skip is a FAIL', async () => {
    const r = prepare('control', null);
    const report = await r.analyze();
    expectInvariant(report);
    expect(onTarget(report).filter((f) => f.severity === 'fail').map((f) => f.rule)).toEqual(['TG003']);
    expect(onTarget(report).some((f) => f.reason === 'scope_unavailable')).toBe(false);
    expectNoReadAfterParse(state.events, [keyOf(r.base), keyOf(r.head)]);
  }, 600_000);

  it("Codex: a second read of base would end with exit 7 → base is read once, the decision stands, no FAIL beside a WARN", async () => {
    const r = prepare('codex', 'base');
    const report = await r.analyze();
    expectInvariant(report);
    // Base is read once in the analysis: the read that would die never happens, and both sides were read: the FAIL.
    expect(state.reads.get(keyOf(r.base))).toBe(1);
    expect(onTarget(report).some((f) => f.reason === 'scope_unavailable')).toBe(false);
    expect(onTarget(report).filter((f) => f.severity === 'fail').map((f) => f.rule)).toEqual(['TG003']);
    expectNoReadAfterParse(state.events, [keyOf(r.base), keyOf(r.head)]);
  }, 600_000);

  it('the read the decision takes dies (head, after the cache was emptied) → one WARN, no FAIL', async () => {
    const r = prepare('decision', 'head');
    const report = await r.analyze();
    expectInvariant(report);
    expect(onTarget(report).filter((f) => f.severity === 'fail')).toEqual([]);
    const unread = onTarget(report).filter((f) => f.reason === 'scope_unavailable');
    expect(unread.map((f) => f.side)).toEqual(['head']);
    expect(unread[0]!.message).toMatch(/exit 7/);
    expectNoReadAfterParse(state.events, [keyOf(r.base), keyOf(r.head)]);
  }, 600_000);
});

describe('the rules read the answers the analysis took, never the reader', () => {
  it('a plain pair: after the target\'s parsing starts, the reader is never asked about it again', async () => {
    const r = run('plain', 0);
    state.events = [];
    state.reads = new Map();
    state.dies = null;
    const report = await r.analyze();
    expect(onTarget(report).filter((f) => f.severity === 'fail').map((f) => f.rule)).toEqual(['TG003']);
    expect([state.reads.get(keyOf(r.base)), state.reads.get(keyOf(r.head))]).toEqual([1, 1]);
    expectNoReadAfterParse(state.events, [keyOf(r.base), keyOf(r.head)]);
  }, 120_000);

  it('the Python extractor and its resolver cannot reach the reader: they take its answer as a value', () => {
    // PyResolver, pyFileInfo and extractPyTests take a PyFacts; only the reader's module, the parse entry point (a
    // standalone parse) and src/check.ts (where a file's answers are taken once) may ask the reader.
    for (const file of ['src/parse/py-binding.ts', 'src/parse/py-assert.ts', 'src/parse/py.ts']) {
      const imports = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').match(/^import[^;]*py-scopes\.js';$/gm) ?? [];
      for (const line of imports) expect(line, file).toMatch(/^import type /);
    }
  });
});
