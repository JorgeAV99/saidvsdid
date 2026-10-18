// The Python scope reader reads, through the real interpreter, everything the earlier reader (main as of
// the commit that recorded the scope reader's hang on macOS: one call per run, a 300 s limit, a 1 GiB pipe for stderr) read: Codex's two reproductions of the
// review of the commit that made the reader-failure test parse with tree-sitter, and a file of about 5 MB. The calls are at most `CALL_BYTES` of source, and each has
// `max(MIN_LIMIT_MS, LIMIT_MS_PER_MB × MB)` and then `RETRY_LIMIT_MS` (src/parse/py-scopes.ts).
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/check.js';
import { analysePython, CALL_BYTES, callLimits, LIMIT_MS_PER_MB, MIN_LIMIT_MS, pythonFacts, RETRY_LIMIT_MS, splitCalls } from '../src/parse/py-scopes.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A unittest class of `m` methods (≈ 60 bytes each): the densest content measured, ≈ 4–5 s/MB. */
function unittestFile(i: number, m: number): string {
  let s = `import unittest\n\n\nclass TestX${i}(unittest.TestCase):\n`;
  for (let j = 0; j < m; j++) s += `    def test_m${j}(self):\n        self.assertEqual(${j}, ${j})\n`;
  return s;
}

/** A table of `n` strings with an invalid escape (`'\d'`): Python 3.12 writes a SyntaxWarning for each on stderr. */
function escapesFile(n: number, skip: boolean): string {
  let s = 'import pytest\n\nTABLE = [\n';
  for (let i = 0; i < n; i++) s += `    '\\d${i}',\n`;
  return s + ']\n\n\ndef test_t():\n' + (skip ? '    pytest.skip("x")\n' : '') + '    assert TABLE\n';
}

describe('the calls and their limits', () => {
  it('a call holds at most CALL_BYTES of source, and a larger file goes alone', () => {
    const f = (n: number) => [{ source: new Uint8Array(n) }];
    const calls = splitCalls([f(400_000), f(400_000), f(400_000), f(3_000_000), f(10), f(999_990), f(1)]);
    expect(calls.map((c) => c.map((x) => x.source.length))).toEqual([[400_000, 400_000], [400_000], [3_000_000], [10, 999_990], [1]]);
    for (const c of calls) if (c.length > 1) expect(c.reduce((n, x) => n + x.source.length, 0)).toBeLessThanOrEqual(CALL_BYTES);
  });

  it('the first limit grows with the call, and the retry has at least the 300 s a whole run had', () => {
    expect([MIN_LIMIT_MS, LIMIT_MS_PER_MB, RETRY_LIMIT_MS]).toEqual([60_000, 60_000, 300_000]);
    expect(callLimits(100_000)).toEqual([60_000, 300_000]);
    expect(callLimits(1_000_000)).toEqual([60_000, 300_000]);
    expect(callLimits(5_000_000)).toEqual([300_000, 300_000]);
    expect(callLimits(8_000_000)).toEqual([480_000, 480_000]);
  });
});

describe('what the earlier reader read is still read (Codex, review of the commit that made the reader-failure test parse with tree-sitter)', () => {
  it('a file whose stderr holds more than 1 MiB of SyntaxWarnings (Python ≥ 3.12): the certain skip is a FAIL, as on main', async () => {
    const base = escapesFile(10_000, false);
    const head = escapesFile(10_000, true);
    const report = await analyze({
      base: '0'.repeat(40),
      head: '1'.repeat(40),
      changes: [{ status: 'M', basePath: 'test_a.py', headPath: 'test_a.py' }],
      read: (side, path) => (path === 'test_a.py' ? (side === 'base' ? base : head) : null),
    });
    expect(report.findings.filter((f) => f.reason === 'scope_unavailable')).toEqual([]);
    expect(report.verdict).toBe('FAIL');
  }, 300_000);

  it('80 files × 2 000 unittest methods (≈ 9.8 MB; main: 217 s in one call here) are all read', () => {
    const files = Array.from({ length: 80 }, (_, i) => enc(unittestFile(i, 2_000)));
    expect(files.reduce((n, f) => n + f.length, 0)).toBeGreaterThan(9_500_000);
    analysePython(files);
    const failed = files.map((f) => pythonFacts(f)).filter((f) => !f.ok);
    expect(failed).toEqual([]);
  }, 900_000);

  it('one file of ≈ 5 MB (a data table; main: ≈ 9 s here) is read', () => {
    let s = 'import pytest\n\nDATA = [\n';
    for (let j = 0; j < 170_000; j++) s += `    (${j}, 'value ${j}'),\n`;
    const file = enc(s + ']\n\n\ndef test_t():\n    assert DATA\n');
    expect(file.length).toBeGreaterThan(4_800_000);
    analysePython([file]);
    expect(pythonFacts(file)).toMatchObject({ ok: true });
  }, 900_000);
});
