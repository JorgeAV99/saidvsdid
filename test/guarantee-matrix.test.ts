// The best-effort detection's cartesian matrix (test/guarantee-matrix.ts, a regression test) is generated from the sources: its axes are
// exactly the lists of src/parse/vocabulary.ts and src/rules/guarantee.ts, every combination it does not run is
// excluded by an entry of MATRIX_EXCLUSIONS with its reason (and every entry excludes something), and every other
// combination is a case. Running the cases is test/silence-guarantee.test.ts's; this file analyses nothing.
import { beforeAll, describe, expect, it } from 'vitest';
import { JS_TOKENS, PY_TOKENS } from '../src/parse/vocabulary.js';
import { accessForms, BY_NAME_PRIMITIVES, BEST_EFFORT_BINDINGS, BEST_EFFORT_RECEIVERS, VOCABULARY_ROOTS, BEST_EFFORT_USES, BEST_EFFORT_FORMS, receivers } from '../src/rules/guarantee.js';
import { bindingVariants, caseOf, combinations, excludedBy, MATRIX_BOUNDS, MATRIX_EXCLUSIONS, MAX_CHAIN_STEPS, members, SUITE_EXCLUSIONS, USES } from './guarantee-matrix.js';

describe('the matrix is generated from the sources', () => {
  it('its axes are the lists of the sources', () => {
    for (const [lang, tokens] of [['python', PY_TOKENS], ['js', JS_TOKENS]] as const) {
      expect(new Set(members(lang).map((m) => m.name)), `${lang} members`).toEqual(new Set(Object.keys(tokens)));
      expect(new Set(bindingVariants(lang).map((b) => b.id)), `${lang} bindings`).toEqual(new Set([...BEST_EFFORT_BINDINGS.map((b) => b.id), 'direct']));
      // Access forms: a dot, a literal subscript, and each by-name primitive in every callee form and arity.
      const forms = accessForms(lang);
      expect(new Set(forms.map((f) => f.group)), `${lang} access`).toEqual(new Set(BEST_EFFORT_FORMS.map((v) => v.id)));
      const primitives = lang === 'python' ? BY_NAME_PRIMITIVES.python : BY_NAME_PRIMITIVES.js.members;
      for (const p of primitives) {
        const callees = lang === 'python' ? [p.name] : [`${BY_NAME_PRIMITIVES.js.object}.${p.name}`, `${BY_NAME_PRIMITIVES.js.object}['${p.name}']`];
        for (const callee of callees) for (let n = p.args[0]; n <= p.args[1]; n++) expect(forms.some((f) => f.id === `${callee}/${n}` && f.reads === p.reads), `${callee}/${n}`).toBe(true);
      }
      // Receivers: every entry of BEST_EFFORT_RECEIVERS, every root, every step that returns the member.
      const recs = receivers(lang, MAX_CHAIN_STEPS);
      expect(new Set(recs.map((r) => r.kind))).toEqual(new Set(BEST_EFFORT_RECEIVERS.map((r) => r.id)));
      expect(new Set(recs.map((r) => r.root))).toEqual(new Set(['identifier', 'this-self']));
      for (const step of forms.filter((f) => f.reads)) {
        for (let at = 0; at < MAX_CHAIN_STEPS; at++) expect(recs.some((r) => r.steps[at]?.id === step.id), `${lang} step ${step.id} at ${at}`).toBe(true);
      }
    }
    expect(new Set(USES)).toEqual(new Set(BEST_EFFORT_USES.map((u) => u.id)));
    expect(new Set([...members('python'), ...members('js')].map((m) => m.root.kind))).toEqual(new Set(VOCABULARY_ROOTS.map((r) => r.id)));
    expect(MATRIX_BOUNDS.map((b) => b.id)).toEqual(['chain-length']);
  });

  // One walk over every combination (ten million), in the hook, under its own limit: the tests read what it found.
  const used = new Map<string, number>();
  const count = { all: 0, full: 0, suite: 0 };
  const inBoth: string[] = [];
  const built = new Map<string, { base: string; head: string; control: string }>();
  beforeAll(() => {
    for (const c of combinations()) {
      count.all++;
      const full = excludedBy(c, 'full');
      const suite = excludedBy(c, 'suite');
      if (full) used.set(full.id, (used.get(full.id) ?? 0) + 1);
      else count.full++;
      if (suite && !full) used.set(suite.id, (used.get(suite.id) ?? 0) + 1);
      if (!suite) count.suite++;
      // The suite runs a slice of the full matrix, never a case the full matrix leaves out.
      if (full && !suite) inBoth.push(full.id);
      const k = `${c.lang} ${c.binding.id}#${c.binding.variant} ${c.use}`;
      if (!full && !built.has(k)) built.set(k, caseOf(c));
    }
  }, 600_000);

  it('every combination is a case or excluded with a reason, and every exclusion excludes something', () => {
    // The full matrix (the CI job) and the suite's slice: what each leaves out is in its list, with its reason.
    expect(inBoth, 'excluded from the full matrix but run by the suite').toEqual([]);
    for (const e of [...MATRIX_EXCLUSIONS, ...SUITE_EXCLUSIONS]) {
      expect(e.reason.length, e.id).toBeGreaterThan(20);
      expect(used.get(e.id) ?? 0, `exclusion ${e.id} excludes nothing`).toBeGreaterThan(0);
    }
    expect(new Set([...MATRIX_EXCLUSIONS, ...SUITE_EXCLUSIONS].map((e) => e.id)).size).toBe(MATRIX_EXCLUSIONS.length + SUITE_EXCLUSIONS.length);
    expect(count.full).toBeGreaterThan(700_000);
    expect(count.suite).toBeGreaterThan(20_000);
    expect(count.suite).toBeLessThan(count.full);
  });

  it('every combination it does not exclude has a template (one of each binding variant × language × use built)', () => {
    expect(built.size).toBeGreaterThan(30);
    for (const [k, c] of built) {
      expect(c.head, k).not.toBe(c.base);
      expect(c.control, k).not.toBe(c.head);
    }
  });
});
