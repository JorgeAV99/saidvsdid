// TG004: an existing test asserts less than it did. Always a WARN, never a FAIL.
//
// A loss of checks is not something the diff proves, nor a runner shows: a check can be written as a guard that
// throws, a `raise`, a helper, and a call that looks like an assertion may check nothing (`pytest.raises(X)` with no
// context and no callable). The rule describes the code — "removes the assertion call X from test Y; it may check
// less" — and leaves the judgement to the reviewer (docs/rules.md, *Verdicts*).
//
// Per paired test (same test at base and head, following renames and moves):
// - fewer assertion calls than at base → warn, listing the ones that are gone;
// - a matcher relaxed on the same subject (`toEqual(x)` → `toBeDefined()`,
//   `toHaveBeenCalledWith` → `toHaveBeenCalled`, `assertEqual` →
//   `assertIsNotNone`, `== x` → `is not None`, a wider `pytest.approx`) → warn;
// - no assertion call left at all → warn, naming a helper the body still calls
//   that may assert on its behalf (moving assertions into a helper is legitimate
//   and common).
//
// Assertions that disappear from a test but reappear in a test added to the
// same file (a test split in two) are not lost.
//
// What is certainly an assertion (an `expect` / `assert` statically imported from a
// runner or an assertion library, Python's `assert`, `self.assertX` inherited
// from unittest.TestCase, `pytest.raises` with `pytest` never rebound in the
// module) shapes the wording; assertions whose root is a global, a local or a
// rebound name are named with why they may not be ones. Messages count call
// sites: "removes 2 assertion calls from …".
import type { Assertion, TestCase } from '../parse/index.js';
import type { TestRef } from './match.js';
import type { CheckContext, Finding, Rule } from './types.js';
import { disablingMarkers, quote, weakestOf } from './util.js';

type Family = 'value' | 'calls' | 'throws';

/** Matcher → (family, rank). Higher rank checks more. Unlisted matchers are not compared. */
const STRENGTH = new Map<string, [Family, number]>();
const def = (family: Family, rank: number, names: string[]): void => {
  for (const n of names) STRENGTH.set(n, [family, rank]);
};
def('value', 2, [
  // JS
  'toBe', 'toEqual', 'toStrictEqual', 'toMatchObject', 'toMatchSnapshot', 'toMatchInlineSnapshot', 'toMatchFileSnapshot',
  'toBeNull', 'toBeUndefined', 'toBeNaN', 'toHaveLength', 'toContain', 'toContainEqual', 'toMatch', 'toBeCloseTo',
  'toHaveProperty', 'to.equal', 'to.eql', 'to.deep.equal', 'to.be.equal', 'to.be.null', 'to.be.undefined',
  'assert.equal', 'assert.strictEqual', 'assert.deepEqual', 'assert.deepStrictEqual', 'assert.is', 'assert.equals',
  // Python
  'assertEqual', 'assertEquals', 'assertDictEqual', 'assertListEqual', 'assertTupleEqual', 'assertSetEqual',
  'assertSequenceEqual', 'assertMultiLineEqual', 'assertCountEqual', 'assertIs', 'assertIsNone', 'assertAlmostEqual',
  'assertIn', '==', 'is None', 'is', 'in',
]);
def('value', 1, [
  'toBeDefined', 'toBeTruthy', 'toBeFalsy', 'not.toBeNull', 'not.toBeUndefined', 'not.toBeFalsy', 'not.toBeNaN',
  'toBeInstanceOf', 'toBeTypeOf', 'to.exist', 'to.be.ok', 'to.not.be.null', 'not.to.be.null', 'to.not.be.undefined',
  'not.to.be.undefined', 'to.be.a', 'to.be.an', 'assert', 'assert.ok', 'assert.exists', 'assert.isOk', 'assert.isDefined',
  'assertTrue', 'assertFalse', 'assertIsNotNone', 'assertIsInstance', 'is not None', 'truthy', 'falsy', 'isinstance',
]);
def('calls', 3, [
  'toHaveBeenCalledWith', 'toHaveBeenLastCalledWith', 'toHaveBeenNthCalledWith', 'toBeCalledWith', 'lastCalledWith',
  'nthCalledWith', 'toHaveBeenCalledExactlyOnceWith', 'toHaveReturnedWith', 'assert_called_with', 'assert_called_once_with',
  'assert_any_call', 'assert_has_calls', 'assert_awaited_with', 'assert_awaited_once_with',
]);
def('calls', 2, ['toHaveBeenCalledTimes', 'toBeCalledTimes', 'toHaveBeenCalledOnce', 'assert_called_once', 'assert_awaited_once']);
def('calls', 1, ['toHaveBeenCalled', 'toBeCalled', 'toHaveReturned', 'assert_called', 'assert_awaited']);
def('throws', 2, ['toThrow', 'toThrowError']);
def('throws', 1, ['toThrow()', 'toThrowError()']);

function strength(a: Assertion): [Family, number] | null {
  return STRENGTH.get(a.matcher) ?? null;
}

/** pytest.approx effective tolerances (pytest semantics for omitted values). */
function tolerance(a: Assertion): { rel: number; abs: number } | null {
  if (!a.approx) return null;
  const { rel, abs } = a.approx;
  if (rel === null && abs === null) return { rel: 1e-6, abs: 1e-12 };
  if (rel === null) return { rel: 0, abs: abs! };
  return { rel, abs: abs ?? 1e-12 };
}

function code(text: string): string {
  const t = text.length > 70 ? `${text.slice(0, 69)}…` : text;
  return `\`${t}\``;
}

function multisetMinus(a: string[], b: string[]): string[] {
  const rest = [...b];
  const out: string[] = [];
  for (const x of a) {
    const i = rest.indexOf(x);
    if (i === -1) out.push(x);
    else rest.splice(i, 1);
  }
  return out;
}

interface Relaxation {
  from: Assertion;
  to: Assertion;
  why: string;
}

function relaxations(base: TestCase, head: TestCase): Relaxation[] {
  const out: Relaxation[] = [];
  const subjects = [...new Set(base.assertionSites.map((a) => a.subject).filter((s): s is string => s !== null))];
  for (const subject of subjects) {
    const before = base.assertionSites.filter((a) => a.subject === subject);
    const after = head.assertionSites.filter((a) => a.subject === subject);
    if (after.length === 0) continue;
    for (const family of ['value', 'calls', 'throws'] as const) {
      const strongest = (list: Assertion[]): Assertion | null =>
        list.filter((a) => strength(a)?.[0] === family).sort((x, y) => strength(y)![1] - strength(x)![1])[0] ?? null;
      const b = strongest(before);
      const h = strongest(after);
      if (b && h && strength(h)![1] < strength(b)![1]) out.push({ from: b, to: h, why: `\`${b.matcher}\` → \`${h.matcher}\`` });
    }
    const tb = before.map(tolerance).find((t) => t !== null);
    const hb = after.find((a) => tolerance(a) !== null);
    const th = hb ? tolerance(hb) : null;
    if (tb && th && hb && (th.rel > tb.rel || th.abs > tb.abs)) {
      const from = before.find((a) => tolerance(a) !== null)!;
      const widened = [th.rel > tb.rel ? `rel ${tb.rel} → ${th.rel}` : '', th.abs > tb.abs ? `abs ${tb.abs} → ${th.abs}` : ''].filter(Boolean);
      out.push({ from, to: hb, why: `pytest.approx tolerance widened: ${widened.join(', ')}` });
    }
  }
  return out;
}

/** Assertion texts of tests that are new in each head file: where split-off assertions go. */
function newTestAssertions(ctx: CheckContext): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const push = (r: TestRef): void => {
    out.set(r.file, [...(out.get(r.file) ?? []), ...r.test.assertionSites.map((a) => a.text)]);
  };
  for (const r of ctx.matching.added) push(r);
  for (const s of ctx.matching.splits) s.heads.forEach(push);
  for (const s of ctx.matching.substitutions) push(s.head);
  return out;
}

export const TG004: Rule = {
  id: 'TG004',
  title: 'Assertions lost or relaxed',
  run(ctx) {
    const findings: Finding[] = [];
    const moved = newTestAssertions(ctx);
    for (const p of ctx.matching.pairs) {
      const base = p.base.test;
      const head = p.head.test;
      const baseCertain = base.assertionSites.filter((a) => a.binding.certain);
      const headCertain = head.assertionSites.filter((a) => a.binding.certain);
      // The same body asserts the same, unless what its assertions are bound to changed (a local `expect`).
      if (base.body === head.body && baseCertain.length === headCertain.length) continue;
      // A body-less `it.todo('x')` is TG003's business.
      if (head.body === '' && disablingMarkers(head).length > 0) continue;
      const baseTexts = base.assertionSites.map((a) => a.text);
      const headTexts = head.assertionSites.map((a) => a.text);
      const available = [...(moved.get(p.head.file) ?? [])];
      const gone = multisetMinus(baseTexts, headTexts).filter((t) => {
        const i = available.indexOf(t);
        if (i === -1) return true;
        available.splice(i, 1); // reappears in a test added to the same file
        return false;
      });
      const lost = Math.min(gone.length, base.assertions - head.assertions);
      const at = { rule: 'TG004' as const, file: p.head.file, side: 'head' as const, test: base.name };

      if (base.assertions > 0 && head.assertions === 0 && lost > 0) {
        const calls = `${base.assertions === 1 ? 'the only assertion call' : `all ${base.assertions} assertion calls`} (${baseTexts.slice(0, 3).map(code).join(', ')}${baseTexts.length > 3 ? ', …' : ''})`;
        // Certain: the test is the runner's on both sides and a removed call is certainly an assertion.
        const doubt = weakestOf([base.binding, head.binding, baseCertain.length > 0 ? { certain: true } : (base.assertionSites[0]?.binding ?? { certain: true })]);
        findings.push(
          head.helperCalls.length > 0
            ? {
                ...at,
                severity: 'warn',
                line: head.line,
                message: `Removes ${calls} from ${quote(base.name)}; it calls ${head.helperCalls.map((h) => `\`${h}\``).join(', ')}, which may assert for it`,
              }
            : {
                ...at,
                severity: 'warn',
                line: head.line,
                message:
                  `Removes ${calls} from ${quote(base.name)} and leaves no call that looks like one; it may check less` +
                  (doubt.certain ? '' : ` (${doubt.why})`),
                tampering: true as const,
              },
        );
        continue;
      }
      if (lost > 0) {
        findings.push({
          ...at,
          severity: 'warn',
          line: head.line,
          message:
            `Removes ${lost} of ${base.assertions} assertion call${base.assertions === 1 ? '' : 's'} from ${quote(base.name)} ` +
            `(${gone.slice(0, 5).map(code).join(', ')}${gone.length > 5 ? `, +${gone.length - 5} more` : ''}); it may check less`,
          tampering: true as const,
        });
      }
      // The calls left look like assertions, but none is certainly one any more (a local `expect`).
      if (baseCertain.length > 0 && headCertain.length === 0 && head.assertions > 0) {
        const doubt = weakestOf(head.assertionSites.map((a) => a.binding));
        findings.push({
          ...at,
          severity: 'warn',
          line: head.line,
          message:
            `The ${head.assertions} assertion call${head.assertions === 1 ? '' : 's'} left in ${quote(base.name)} may not assert` +
            (doubt.certain ? '' : `: ${doubt.why}`) +
            ` (${baseCertain.length} at base certainly did: ${baseCertain.slice(0, 3).map((a) => code(a.text)).join(', ')})`,
          tampering: true as const,
        });
      }
      for (const r of relaxations(base, head)) {
        findings.push({
          ...at,
          severity: 'warn',
          line: r.to.line,
          message: `Changes ${code(r.from.text)} to ${code(r.to.text)} in ${quote(base.name)}: a weaker matcher on the same subject (${r.why})`,
          tampering: true as const,
        });
      }
    }
    return findings;
  },
};
