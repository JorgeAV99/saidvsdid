// TG004 details the fixtures do not pin down: what counts as an assertion,
// which calls may assert on a test's behalf, and splits without a rename.
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/check.js';
import { parseTestFile } from '../src/parse/index.js';

async function tg004(path: string, base: string, head: string): Promise<string[]> {
  const report = await analyze({
    base: '0'.repeat(40),
    head: '1'.repeat(40),
    changes: [{ status: 'M', basePath: path, headPath: path }],
    read: (side) => (side === 'base' ? base : head),
  });
  return report.findings.filter((f) => f.rule === 'TG001' || f.rule === 'TG004').map((f) => `${f.severity} ${f.rule} ${f.test ?? ''}: ${f.message}`);
}

describe('assertion extraction (JS/TS)', () => {
  it('counts expect only with a matcher, plus assert, chai, sinon and expect.assertions', async () => {
    const f = await parseTestFile(
      'a.test.ts',
      `it('x', async () => {
  expect.assertions(4);
  expect(a);
  expect(a).toBe;
  expect(a).not.toBeNull();
  await expect(p).resolves.toEqual(1);
  expect(b).to.be.true;
  assert.deepEqual(c, 1);
  sinon.assert.calledWith(spy, 2);
  expect(() => f()).toThrow();
});`,
    );
    expect(f.tests[0]!.assertionSites.map((a) => [a.subject, a.matcher])).toEqual([
      [null, 'expect.assertions'],
      ['a', 'not.toBeNull'],
      ['p', 'toEqual'],
      ['b', 'to.be.true'],
      ['c', 'assert.deepEqual'],
      ['spy', 'assert.calledWith'],
      ['() => f()', 'toThrow()'],
    ]);
  });

  it('lists only the calls that may assert', async () => {
    const f = await parseTestFile(
      'b.test.ts',
      `import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { build } from '../src/build';
import * as h from './helpers/dom';
const pure = (x) => x + 1;
function asserting(x) { expect(x).toBe(1); }
function indirect(x) { asserting(x); }
it('x', () => {
  const spy = vi.fn();
  build(pure(1), JSON.stringify({}));
  render(spy);
  console.log(Math.max(1, 2));
  indirect(1);
  h.click();
  verifyShape(1);
  registeredGlobally();
  runWith(expect);
});`,
    );
    // Testing Library is a test-support package (its getBy* queries throw): conservatively listed.
    expect(f.tests[0]!.helperCalls).toEqual(['h.click', 'indirect', 'registeredGlobally', 'render', 'runWith', 'verifyShape']);
  });
});

describe('assertion extraction (Python)', () => {
  it('classifies assert statements, unittest and mock assertions', async () => {
    const f = await parseTestFile(
      'test_a.py',
      `def test_x(mock_send):
    assert a == 1
    assert b is None
    assert c != None
    assert not d
    assert isinstance(e, int)
    assert f == pytest.approx(1.0, abs=1e-3)
    assert g == approx(1.0, rel=tol)
    mock_send.assert_called_once_with(1)
    with pytest.raises(ValueError):
        h()
`,
    );
    expect(f.tests[0]!.assertionSites.map((a) => [a.subject, a.matcher, a.approx ?? null])).toEqual([
      ['a', '==', null],
      ['b', 'is None', null],
      ['c', 'is not None', null],
      ['d', 'falsy', null],
      ['e', 'isinstance', null],
      ['f', '== approx', { rel: null, abs: 1e-3 }],
      ['g', '==', null],
      ['mock_send', 'assert_called_once_with', null],
      [null, 'pytest.raises', null],
    ]);
    expect(f.tests[0]!.helperCalls).toEqual(['h']);
  });
});

describe('TG004', () => {
  it('a split into two tests that share no rename keeps every assertion: info, no loss', async () => {
    const findings = await tg004(
      'a.test.ts',
      `it('parses and formats', () => { expect(parse('a,b')).toEqual(['a', 'b']); expect(format(['a'])).toBe('#a'); });`,
      `it('reads comma lists', () => { const xs = 'a,b'; expect(parse('a,b')).toEqual(['a', 'b']); expect(xs.length).toBe(3); });
it('renders hashtags', () => { const out = []; expect(format(['a'])).toBe('#a'); expect(out).toEqual([]); });`,
    );
    expect(findings).toEqual([
      'info TG001 parses and formats: Test "parses and formats" was split into "reads comma lists", "renders hashtags"; all 2 of its assertions were kept',
    ]);
  });

  it('a local helper that asserts nothing does not rescue a test without assertions', async () => {
    const findings = await tg004(
      'a.test.ts',
      `import { expect, it } from 'vitest';\nit('x', () => { expect(make()).toEqual({ a: 1 }); });`,
      `import { expect, it } from 'vitest';\nconst make = () => ({ a: 1 });
it('x', () => { make(); });`,
    );
    expect(findings).toHaveLength(1);
    // A WARN, never a FAIL (round 13): a loss of checks is not provable.
    expect(findings[0]).toMatch(/^warn TG004 x: Removes the only assertion call .* from "x" and leaves no call that looks like one; it may check less$/);
  });

  it('with the runner\'s globals (no import) the same removal is a WARN that says why', async () => {
    const findings = await tg004(
      'a.test.ts',
      `it('x', () => { expect(make()).toEqual({ a: 1 }); });`,
      `const make = () => ({ a: 1 });
it('x', () => { make(); });`,
    );
    expect(findings).toEqual([expect.stringMatching(/^warn TG004 x: Removes the only assertion call .*; it may check less \(`it` is a global, and no Jest invocation saidvsdid can read runs this file\)$/)]);
  });

  it('a test that becomes a body-less todo is left to TG003', async () => {
    expect(await tg004('a.test.ts', `it('x', () => { expect(1).toBe(1); });`, `it.todo('x');`)).toEqual([]);
  });

  it('approx with a non-literal tolerance is not compared', async () => {
    const findings = await tg004(
      'test_a.py',
      `def test_x():\n    assert f() == pytest.approx(1.0, rel=1e-6)\n`,
      `def test_x():\n    assert f() == pytest.approx(1.0, rel=TOL)\n`,
    );
    expect(findings).toEqual([]);
  });
});
