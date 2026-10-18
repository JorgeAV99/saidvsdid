// Development aid: for every fixture whose report differs from its case.json,
// print the expected and actual findings and verdict; with --write, rewrite the
// expectation from the actual report (review the printed diff first).
//   npx tsx fixtures/diff-expect.ts [filter] [--write]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { buildFixtureRepo, caseCwd, caseEvidence, linkNodeModules, listCases, transcriptPath, unlinkNodeModules } from './build.js';
import { runCheck } from '../src/check.js';
import { parseEvidence } from '../src/evidence/schema.js';
import { RULE_FAIL_EFFECT } from '../src/rules/effects.js';
import type { RuleId } from '../src/rules/types.js';

const args = process.argv.slice(2);
const write = args.includes('--write');
const filter = args.find((a) => !a.startsWith('--')) ?? '';
const work = mkdtempSync(join(tmpdir(), 'saidvsdid-diff-'));
const key = (f: { rule: string; severity: string; file: string; line?: number | null; test?: string | null; reason?: string; effect?: string; ids?: string[] }): string =>
  `${f.rule} ${f.severity} ${f.file}${f.line != null ? `:${f.line}` : ''}${f.test ? ` [${f.test}]` : ''}${f.reason ? ` (${f.reason})` : ''}${f.effect ? ` {${f.effect}}` : ''}${f.ids ? ` <${f.ids.join('|')}>` : ''}`;
// A FAIL's effect is written only when it is not its rule's (src/rules/effects.ts).
const ownEffect = (f: { rule: string; severity: string; effect?: string }): string | undefined =>
  f.severity === 'fail' && f.effect !== undefined && f.effect !== RULE_FAIL_EFFECT[f.rule as RuleId] ? f.effect : undefined;

let changed = 0;
for (const c of listCases().filter((x) => x.id.includes(filter))) {
  const built = buildFixtureRepo(c.dir, join(work, c.id), c.session, c.links);
  if (c.f2p) linkNodeModules(built.repo);
  const transcript = transcriptPath(c);
  const ev = caseEvidence(c, built);
  const parsed = ev === null ? null : parseEvidence(ev);
  const report = await runCheck({
    repo: built.repo,
    base: built.base,
    head: built.head,
    exclude: c.exclude ?? [],
    transcript: transcript ? { text: readFileSync(transcript, 'utf8'), agent: c.agent ?? 'auto', label: basename(transcript) } : null,
    ...(parsed?.ok ? { evidence: parsed.value, evidenceLabel: basename(c.evidence!) } : {}),
    cwd: caseCwd(c),
    f2p: c.f2p ? { timeoutMs: 120_000 } : null,
  });
  if (c.f2p) unlinkNodeModules(built.repo);
  const pinned = new Set(c.expect.findings.filter((f) => f.reason !== undefined).map((f) => `${f.rule}|${f.severity}`));
  const actual = report.findings.map((f) => ({ rule: f.rule, severity: f.severity, file: f.file, line: f.line, test: f.test, ...(ownEffect(f) !== undefined ? { effect: ownEffect(f) } : {}), ...(f.severity === 'fail' && f.ids !== undefined ? { ids: f.ids } : {}), ...(f.reason !== undefined && (pinned.has(`${f.rule}|${f.severity}`) || f.severity === 'info' && (f.rule === 'TG006' || f.rule === 'TG007')) ? { reason: f.reason } : {}) }));
  const want = c.expect.findings.map(key).sort();
  const got = actual.map(key).sort();
  const unv = JSON.stringify(report.unverifiable.map((u) => ({ file: u.file, side: u.side }))) !== JSON.stringify(c.expect.unverifiable ?? []);
  if (JSON.stringify(want) === JSON.stringify(got) && report.verdict === c.expect.verdict && !unv) continue;
  changed++;
  console.log(`== ${c.id}: ${c.expect.verdict} → ${report.verdict}`);
  for (const w of want) if (!got.includes(w)) console.log(`  - ${w}`);
  for (const g of got) if (!want.includes(g)) console.log(`  + ${g}`);
  if (write) {
    const file = join(c.dir, 'case.json');
    const meta = JSON.parse(readFileSync(file, 'utf8'));
    meta.expect.verdict = report.verdict;
    meta.expect.findings = actual;
    if (report.unverifiable.length) meta.expect.unverifiable = report.unverifiable.map((u) => ({ file: u.file, side: u.side }));
    else delete meta.expect.unverifiable;
    writeFileSync(file, JSON.stringify(meta, null, 2) + '\n');
  }
}
rmSync(work, { recursive: true, force: true });
console.log(`${changed} fixture(s) differ${write ? ' (rewritten)' : ''}`);
