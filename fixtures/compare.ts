// Verdicts of `check` and `baseline` against each fixture's expected verdict:
// `npx tsx fixtures/compare.ts`. A preview of the benchmark, not the benchmark.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBaseline } from '../src/baseline.js';
import { runCheck } from '../src/check.js';
import { buildFixtureRepo, listCases } from './build.js';

const workdir = mkdtempSync(join(tmpdir(), 'saidvsdid-compare-'));
const tally = { check: 0, baseline: 0, total: 0 };
const misses: string[] = [];
try {
  for (const c of listCases()) {
    const r = buildFixtureRepo(c.dir, join(workdir, c.id));
    const check = (await runCheck({ ...r, exclude: c.exclude ?? [] })).verdict;
    const baseline = runBaseline(r).verdict;
    tally.total++;
    if (check === c.expect.verdict) tally.check++;
    if (baseline === c.expect.verdict) tally.baseline++;
    else misses.push(`${c.id.padEnd(46)} expected ${c.expect.verdict.padEnd(12)} baseline ${baseline}`);
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
console.log(misses.join('\n'));
console.log(`\nexact verdict: check ${tally.check}/${tally.total}, baseline ${tally.baseline}/${tally.total}`);
