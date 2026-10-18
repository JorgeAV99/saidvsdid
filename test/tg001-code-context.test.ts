// TG001's context about the local code a removed test used (src/rules/withcode.ts): one sentence for the reviewer,
// never a verdict. The code may survive under another name or path (Codex review of the noise round), so a removed
// test keeps the severity it has without the sentence; the fixtures pin the verdicts (TG001/code-*,
// deleted-with-its-module-*, removed-test-symbol-gone, control deleted-module-other-kept).
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/check.js';
import type { FileChange } from '../src/git/diff.js';
import type { Report } from '../src/report/model.js';

const CONTEXT = /the local code (?:this test|it|they|these tests|\d+ of them) used also changed or is gone in this PR/;

function changesBetween(base: Map<string, string>, head: Map<string, string>): FileChange[] {
  const out: FileChange[] = [];
  for (const p of [...new Set([...base.keys(), ...head.keys()])].sort()) {
    const b = base.get(p);
    const h = head.get(p);
    if (b === h) continue;
    out.push({ status: b === undefined ? 'A' : h === undefined ? 'D' : 'M', basePath: b === undefined ? null : p, headPath: h === undefined ? null : p });
  }
  return out;
}

async function reportOf(base: Record<string, string>, head: Record<string, string>): Promise<Report> {
  const b = new Map(Object.entries(base));
  const h = new Map(Object.entries(head));
  return analyze({ base: '0'.repeat(40), head: '1'.repeat(40), changes: changesBetween(b, h), read: (side, path) => (side === 'base' ? b : h).get(path) ?? null });
}

const TAX = 'export function computeTax(a: number): number {\n  return a * 0.21;\n}\nexport function slug(s: string): string {\n  return s;\n}\n';
const TEST = (tests: string[]): string =>
  `import { expect, it } from 'vitest';\nimport { computeTax, slug } from '../src/tax';\n\n${tests.join('\n\n')}\n`;
const TAX_TEST = "it('computes tax', () => {\n  expect(computeTax(100)).toBe(21);\n});";
const TAX_TEST_2 = "it('rounds tax', () => {\n  expect(computeTax(1)).toBe(0.21);\n});";
const SLUG_TEST = "it('slugs', () => {\n  expect(slug('a')).toBe('a');\n});";

describe('TG001: context about the local code a removed test used', () => {
  it('a deleted file whose function is renamed keeps its FAIL, with the sentence', async () => {
    const report = await reportOf(
      { 'src/tax.ts': TAX, 'test/tax.test.ts': TEST([TAX_TEST, TAX_TEST_2]) },
      { 'src/tax.ts': TAX.replace('computeTax', 'calculateTax') },
    );
    expect(report.verdict).toBe('FAIL');
    const f = report.findings.filter((x) => x.rule === 'TG001');
    expect(f.map((x) => x.severity)).toEqual(['fail']);
    expect(f[0]!.message).toMatch(/; the local code they used also changed or is gone in this PR$/);
  });

  it('two removed tests with the same cause are one WARN, the sentence in the plural', async () => {
    const report = await reportOf(
      { 'src/tax.ts': TAX, 'test/tax.test.ts': TEST([TAX_TEST, TAX_TEST_2, SLUG_TEST]) },
      { 'src/tax.ts': TAX.replace('computeTax', 'calculateTax'), 'test/tax.test.ts': TEST([SLUG_TEST]) },
    );
    expect(report.verdict).toBe('WARN');
    const f = report.findings.filter((x) => x.rule === 'TG001');
    expect(f.map((x) => [x.severity, x.tests])).toEqual([['warn', ['computes tax', 'rounds tax']]]);
    expect(f[0]!.message).toMatch(/^Removes 2 tests; the local code these tests used also changed or is gone in this PR/);
  });

  it('no sentence when a local name the test used survives at head', async () => {
    const report = await reportOf(
      { 'src/tax.ts': TAX, 'test/tax.test.ts': TEST([TAX_TEST, SLUG_TEST]) },
      { 'src/tax.ts': TAX, 'test/tax.test.ts': TEST([SLUG_TEST]) },
    );
    const f = report.findings.filter((x) => x.rule === 'TG001');
    expect(f.map((x) => x.severity)).toEqual(['warn']);
    expect(f[0]!.message).not.toMatch(CONTEXT);
  });

  it('the sentence never lowers a severity: the same findings as with the module unchanged, but for the words', async () => {
    const base = { 'src/tax.ts': TAX, 'test/tax.test.ts': TEST([TAX_TEST, TAX_TEST_2]) };
    const changed = await reportOf(base, { 'src/tax.ts': TAX.replace('computeTax', 'calculateTax') });
    const unchanged = await reportOf(base, { 'src/tax.ts': TAX });
    const shape = (r: Report): unknown[] => r.findings.map((x) => [x.rule, x.severity, x.file, x.line, x.test, x.ids ?? null, x.message.replace(CONTEXT, '').replace(/; $/, '')]);
    expect(shape(changed)).toEqual(shape(unchanged));
    expect(changed.verdict).toBe(unchanged.verdict);
  });
});
