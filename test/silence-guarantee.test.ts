// Best-effort detection (src/rules/guarantee.ts; docs/rules.md, *Best-effort detection*), protected against
// regressions: through the whole pipeline (`analyze`), the cases of the cartesian matrix generated from the sources
// (test/guarantee-matrix.ts) that the normal suite runs — every combination but the ones MATRIX_EXCLUSIONS and SUITE_EXCLUSIONS list, each with
// its reason; the CI job `guarantee matrix (full)` runs the rest (scripts/guarantee-matrix.ts). The definition already
// at base, a new use at head: at least a WARN on the file; its control, the use replaced by a harmless call: nothing
// above INFO. The cases are analysed in batches (one `analyze` of many files, one Python interpreter per batch, what a
// real run does) in the hook, under its own limit; every case is its own test.
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyze } from '../src/check.js';
import { analyseFiles, holds, placedCases, type FileResult, type Placed } from './guarantee-matrix.js';

const ROOT = resolve(__dirname, '..');

const cases: Placed[] = [...placedCases('suite')];
const files = (p: Placed): Array<{ path: string; base: string; head: string }> => [
  { path: p.at, base: p.c.base, head: p.c.head },
  { path: p.control, base: p.c.base, head: p.c.control },
];

describe('the matrix (the suite\'s cases): a new use is at least a WARN, its control nothing above INFO', () => {
  const results = new Map<string, FileResult>();
  /** One case of each binding variant, analysed by itself: what a batch must read for it. */
  const firsts = [...new Map(cases.map((p) => [p.title.split(' × ')[0], p])).values()];
  const alone = new Map<string, FileResult>();
  beforeAll(async () => {
    for (const [k, v] of await analyseFiles(analyze, cases.flatMap(files))) results.set(k, v);
    for (const p of firsts) for (const [k, v] of await analyseFiles(analyze, files(p))) alone.set(k, v);
  }, 900_000);

  it('covers the suite\'s slice of the matrix', () => {
    expect(cases.length).toBeGreaterThan(20_000);
  });

  it('a batch reads each file as alone (one case of each binding variant, analysed by itself)', () => {
    expect(firsts.length).toBeGreaterThan(30);
    for (const p of firsts) {
      expect(alone.get(p.at)?.severity, p.title).toBe(results.get(p.at)?.severity);
      expect(alone.get(p.control)?.severity, `control of ${p.title}`).toBe(results.get(p.control)?.severity);
    }
  });

  it.each(cases.map((p) => [p.title, p] as const))('%s', (_title, p) => {
    const use = results.get(p.at)!;
    const control = results.get(p.control)!;
    expect(p.c.control, p.title).not.toBe(p.c.head);
    expect(['WARN', 'FAIL'], `${p.title}\n--- head ---\n${p.c.head}`).toContain(use.severity);
    expect(['OK', 'INFO'], `control of ${p.title}\n--- control ---\n${p.c.control}\n--- findings ---\n${control.said.join('\n')}`).toContain(control.severity);
    expect(holds({ use, control })).toBe(true);
  });
});
