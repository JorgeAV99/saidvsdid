// Runs the best-effort detection's cartesian matrix (test/guarantee-matrix.ts, a regression test) outside the test suite: the whole of it, or
// one shard, through the whole pipeline. The CI job `guarantee matrix (full)` runs it in shards; the suite runs only
// its slice (test/silence-guarantee.test.ts).
//
//   npx tsx scripts/guarantee-matrix.ts [--shard 0 --shards 8] [--mode full|suite] [--analyzer <repo root>] [--out failing.jsonl] [--report shard.json]
//   npx tsx scripts/guarantee-matrix.ts --count [--mode full|suite]              # the number of cases, nothing run
//   npx tsx scripts/guarantee-matrix.ts --verify <dir> --shards 8 [--mode full]  # the shards' reports add up
//
// `--analyzer` runs another checkout's `analyze` (src/check.ts) against this checkout's matrix: how a change is shown
// to bite on an older revision. Exit 1 when a case's use is not at least a WARN or its control is above INFO, and
// when the shard ran no case at all. `--verify` fails closed: every shard reported once, none empty, none failing,
// and their cases add up to the total the generator counts (test/guarantee-matrix.ts, `verifyShards`).
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyseFiles, BATCH, countCases, holds, placedCases, verifyShards, type Analyze, type MatrixMode, type Placed, type ShardReport } from '../test/guarantee-matrix.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => (args.includes(name) ? args[args.indexOf(name) + 1]! : fallback);
const shard = Number(opt('--shard', '0'));
const shards = Number(opt('--shards', '1'));
const mode = opt('--mode', 'full') as MatrixMode;
const analyzer = resolve(opt('--analyzer', HERE));
const out = opt('--out', '');
const report = opt('--report', '');
if (!(Number.isInteger(shards) && Number.isInteger(shard) && shards >= 1 && shard >= 0 && shard < shards) || (mode !== 'full' && mode !== 'suite')) {
  console.error('usage: guarantee-matrix.ts [--shard i --shards n] [--mode full|suite] [--analyzer root] [--out file] [--report file] | --count | --verify dir');
  process.exit(2);
}

if (args.includes('--count')) {
  console.log(JSON.stringify({ mode, cases: countCases(mode) }));
  process.exit(0);
}

if (args.includes('--verify')) {
  const dir = opt('--verify', '');
  let reports: ShardReport[] = [];
  try {
    reports = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as ShardReport);
  } catch (e) {
    console.error(`the shards' reports could not be read from ${dir}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  const total = countCases(mode);
  const problems = verifyShards(reports, { mode, shards, total });
  for (const r of reports.sort((a, b) => a.shard - b.shard)) console.log(`shard ${r.shard}: ${r.cases} cases, ${r.failures} failing`);
  console.log(`total: ${reports.reduce((a, r) => a + r.cases, 0)} of ${total}`);
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(problems.length > 0 ? 1 : 0);
}

const { analyze } = (await import(pathToFileURL(resolve(analyzer, 'src', 'check.ts')).href)) as { analyze: Analyze };
if (out) writeFileSync(out, '');
const started = Date.now();
let cases = 0;
const failing: string[] = [];
let batch: Placed[] = [];
const flush = async (): Promise<void> => {
  const results = await analyseFiles(analyze, batch.flatMap((p) => [{ path: p.at, base: p.c.base, head: p.c.head }, { path: p.control, base: p.c.base, head: p.c.control }]));
  for (const p of batch) {
    const use = results.get(p.at)!;
    const control = results.get(p.control)!;
    if (holds({ use, control })) continue;
    failing.push(p.title);
    const line = { title: p.title, use: use.severity, control: control.severity, said: control.said };
    if (out) appendFileSync(out, `${JSON.stringify(line)}\n`);
    if (failing.length <= 20) console.log(`FAIL ${p.title}: use ${use.severity}, control ${control.severity}${control.said.length ? ` (${control.said.join('; ')})` : ''}`);
  }
  batch = [];
};
for (const p of placedCases(mode, shard, shards)) {
  cases++;
  batch.push(p);
  if (batch.length * 2 >= BATCH) await flush();
}
if (batch.length > 0) await flush();
const seconds = Math.round((Date.now() - started) / 100) / 10;
console.log(JSON.stringify({ mode, shard, shards, cases, failing: failing.length, seconds, analyzer: analyzer === HERE ? 'this checkout' : analyzer }));
if (report) writeFileSync(report, `${JSON.stringify({ mode, shard, shards, cases, failures: failing.length } satisfies ShardReport)}\n`);
// Fails closed: a shard that ran nothing proves nothing.
if (cases === 0) console.error(`FAIL shard ${shard} of ${shards} ran no case`);
process.exit(failing.length > 0 || cases === 0 ? 1 : 0);
