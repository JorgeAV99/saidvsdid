import { describe, expect, it } from 'vitest';
import { analyze } from '../src/check.js';
import { countAssertionTokens, countMarkers, markerNet } from '../src/rules/net.js';

describe('marker safety net', () => {
  it('counts the vocabulary per kind, ignoring comments and strings', async () => {
    const counts = await countMarkers(
      'a.test.ts',
      `// it.only('commented')
const s = "it.skip('in a string')";
it('a', { skip: true }, () => {});
it('b', { only: true, todo: true }, () => {});
describe.each([it.only])('t %#', (t) => {});
fit('c', () => {}); xit('d', () => {});
test.fixme(); test.fail(); it.fails('e', () => {});
ctx.skip();
`,
    );
    expect(counts).toEqual({ skip: 3, only: 3, todo: 1, fixme: 1, xfail: 2 });
  });

  it('a literal subscript is a member access, and escapes in identifiers and subscripts are decoded (case D)', async () => {
    const bs = String.fromCharCode(92);
    const counts = await countMarkers(
      'a.test.ts',
      `it['skip']('a', () => {});
test[\`only\`]('b', () => {});
ctx['${bs}u0073kip']();
${bs}u0069t.${bs}u0074odo('c');
x[name]('d');
const s = "it['only']";
`,
    );
    expect(counts).toEqual({ skip: 2, only: 1, todo: 1, fixme: 0, xfail: 0 });
  });

  it('word boundaries are Unicode-aware and Python names NFKC-normalised', async () => {
    const longS = String.fromCharCode(0x17f);
    expect(await countMarkers('test_a.py', `import pytest\n\n\n@pytest.mark.${longS}kip\ndef test_a():\n    pyte${longS}t.skip("x")\n`)).toEqual({ skip: 2, only: 0, todo: 0, fixme: 0, xfail: 0 });
    // `éxit(` is a call of the name `éxit`, not jest's `xit`.
    expect(await countMarkers('a.test.js', `${String.fromCharCode(0xe9)}xit('a', () => {});\n`)).toEqual({ skip: 0, only: 0, todo: 0, fixme: 0, xfail: 0 });
  });

  it('parentheses and type assertions are read away, as the extractor reads them', async () => {
    const none = { skip: 0, only: 0, todo: 0, fixme: 0, xfail: 0 };
    expect(await countMarkers('test_a.py', 'import unittest\n\n\ndef test_a():\n    raise (unittest.SkipTest)\n')).toEqual({ ...none, skip: 1 });
    expect(await countMarkers('a.test.ts', "import { fit } from '@jest/globals';\n(fit as typeof fit)('a', () => {});\n(<any>fit)('b', () => {});\nfit!('c', () => {});\n")).toEqual({ ...none, only: 3 });
    // A literal subscript through the same normalisation: `it[('skip')]`, `it['skip' as const]`.
    expect(await countMarkers('a.test.ts', "it[('skip')]('a', () => {});\nit['skip' as const]('b', () => {});\nit[('o' + 'nly')]('c', () => {});\n")).toEqual({ ...none, skip: 2 });
  });

  it('Python: SkipTest counts only when raised', async () => {
    const counts = await countMarkers(
      'test_a.py',
      `# @pytest.mark.skip
err = unittest.SkipTest("x")
raise unittest.SkipTest("y")
@pytest.mark.xfail(strict=True)
@unittest.skip("z")
def test_a(): pass
`,
    );
    expect(counts).toEqual({ skip: 2, only: 0, todo: 0, fixme: 0, xfail: 1 });
  });

  it('warns once per file and kind that grew, and only for selected rules', async () => {
    const files = [{ basePath: 'a.test.ts', headPath: 'a.test.ts', base: `it('a', () => {});`, head: `it('a', { only: true }, () => {}); x.skip();` }];
    const all = await markerNet({ files, rules: ['TG002', 'TG003'] });
    expect(all.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ['TG003', 'warn', 'Marker added that the analyzer could not attribute: `skip` markers in this file went from 0 to 1'],
      ['TG002', 'warn', 'Marker added that the analyzer could not attribute: `only` markers in this file went from 0 to 1'],
    ]);
    expect((await markerNet({ files, rules: ['TG003'] })).map((f) => f.rule)).toEqual(['TG003']);
  });

  it('counts assertion tokens outside comments and strings', async () => {
    expect(await countAssertionTokens('a.test.ts', `// expect(x).toBe(1)
const s = "assert(x)";
expect(a).toBe(1); expect.soft(b).toBe(2); expect.assertions(1); assert.equal(c, 1); assert(d);`)).toBe(5);
    expect(await countAssertionTokens('test_a.py', `# assert x
assert a == 1
self.assertEqual(b, 1)
m.assert_called_once()
with pytest.raises(E):
    pass
`)).toBe(4);
  });

  it('an assertion removed where no test sees it (a helper) never ends in PASS', async () => {
    const base = `function check(x) { expect(x).toBe(1); }
it('a', () => { check(1); });
`;
    const head = `function check(x) { void x; }
it('a', () => { check(1); });
`;
    const report = await analyze({
      base: '0'.repeat(40),
      head: '1'.repeat(40),
      changes: [{ status: 'M', basePath: 'a.test.ts', headPath: 'a.test.ts' }],
      read: (side) => (side === 'base' ? base : head),
    });
    expect(report.verdict).toBe('WARN');
    expect(report.findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ['TG004', 'warn', 'Assertion removed that the analyzer could not attribute to a test: assertions in this file went from 1 to 0 (1 → 0 across the changed test files)'],
    ]);
  });
});
