// Prints the text report of `check` for fixture cases: `npx tsx fixtures/show.ts TG004/net-loss [...]`.
// A prefix (`TG004/`) selects every case under it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheck } from '../src/check.js';
import { renderText } from '../src/report/text.js';
import { buildFixtureRepo, listCases } from './build.js';

const wanted = process.argv.slice(2);
const workdir = mkdtempSync(join(tmpdir(), 'saidvsdid-show-'));
try {
  for (const c of listCases().filter((c) => wanted.some((w) => c.id === w || (w.endsWith('/') && c.id.startsWith(w))))) {
    const { repo, base, head } = buildFixtureRepo(c.dir, join(workdir, c.id));
    const report = await runCheck({ repo, base, head, exclude: c.exclude ?? [] });
    process.stdout.write(`=== ${c.id} (${c.kind}, expected ${c.expect.verdict})\n${renderText(report).split('\n').slice(3).join('\n')}\n`);
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
