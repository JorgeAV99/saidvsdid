// The silence guarantee, against the real runners: every combination of src/rules/guarantee.ts (`contractCases`:
// runner × form × member, directly from its root and through a simple alias) has a fixture with the real runner's
// evidence that puts at least a WARN on the use (test/contract-fixtures.ts). test/runner-evidence.test.ts checks each
// of those fixtures against what the runner did; docs/rules.md states the guarantee as `renderGuarantee` renders it.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRACT_PENDING, contractCases, renderBestEffort, renderGuarantee } from '../src/rules/guarantee.js';
import { contractCoverage } from './contract-fixtures.js';

const ROOT = resolve(__dirname, '..');
const coverage = contractCoverage();

describe('the silence guarantee: direct forms and the simple alias', () => {
  it('docs/rules.md states the guarantee and the best-effort detection as src/rules/guarantee.ts renders them', () => {
    const rules = readFileSync(join(ROOT, 'docs', 'rules.md'), 'utf8');
    expect(/<!-- silence-guarantee:start -->\n([\s\S]*?)\n<!-- silence-guarantee:end -->/.exec(rules)?.[1]).toBe(renderGuarantee());
    expect(/<!-- best-effort:start -->\n([\s\S]*?)\n<!-- best-effort:end -->/.exec(rules)?.[1]).toBe(renderBestEffort());
  });

  it('the combinations are every runner, every member of its API in each form, directly and through the alias', () => {
    const cases = contractCases();
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(new Set(cases.map((c) => c.runner))).toEqual(new Set(['vitest', 'jest', 'playwright', 'node:test', 'pytest', 'unittest']));
    // The alias exists for every form but an option and a decorator imported by name.
    for (const c of cases.filter((x) => x.form === 'direct')) {
      expect(cases.some((x) => x.id === c.id.replace(/direct$/, 'alias')), c.id).toBe(c.shape !== 'option' && c.shape !== 'decorator');
    }
  });

  const pending = new Set(CONTRACT_PENDING.map((p) => p.id));
  it.each(coverage.filter(({ c }) => !pending.has(c.id)).map(({ c, carriers }) => [c.id, carriers] as const))('%s has a fixture with the real runner', (_id, carriers) => {
    expect(carriers.length).toBeGreaterThan(0);
  });

  it('a combination pending a decision is one of the guarantee, has no fixture yet, and is in the backlog', () => {
    const backlog = readFileSync(join(ROOT, 'docs', 'backlog.md'), 'utf8');
    for (const id of pending) {
      const entry = coverage.find(({ c }) => c.id === id);
      expect(entry, id).toBeDefined();
      expect(entry!.carriers, `${id} has a fixture: take it off CONTRACT_PENDING`).toEqual([]);
      expect(backlog, id).toContain(id);
    }
  });
});
