import { describe, expect, it } from 'vitest';
import { isLooseTestPath, isTestPath, parseTestFile, type TestCase } from '../src/parse/index.js';

type Row = [name: string, line: number, assertions: number, markers: string[]];

function rows(tests: TestCase[]): Row[] {
  return tests.map((t) => [t.name, t.line, t.assertions, t.markers.map((m) => `${m.kind}:${m.condition}:${m.scope}@${m.line}`)]);
}

describe('TypeScript extraction', () => {
  it('handles vitest/jest/playwright shapes', async () => {
    const f = await parseTestFile(
      'a.test.ts',
      `import { describe, it, test, expect } from 'vitest';
describe('math', () => {
  it('adds', () => { expect(1 + 1).toBe(2); expect.soft(3).toBe(3); });
  it.only('subs', () => { expect(1).toBe(1) });
  it.skipIf(process.platform === 'win32')('win', () => {});
  it.todo('later');
  describe.skip('inner', () => { test('x', () => { assert.equal(1, 1) }) });
  it.each([1, 2])('each %i', (n) => { expect(n).toBeTruthy() });
  it('ctx', (ctx) => { if (flag) ctx.skip(); expect(1).toBe(1) });
  test('opts', { timeout: 10 }, () => { expect(expect.anything()).toBeTruthy() });
});
test.describe('pw', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'nope');
  test('a', async ({ page }) => { test.fixme(); await expect(page).toHaveTitle('x') });
});
fit('focused', () => {});
xit('parked', () => {});
`,
    );
    expect(f.parseErrors).toBe(false);
    expect(rows(f.tests)).toEqual([
      ['math > adds', 3, 2, []],
      ['math > subs', 4, 1, ['only:unconditional:test@4']],
      ['math > win', 5, 0, ['skip:environment:test@5']],
      ['math > later', 6, 0, ['todo:unconditional:test@6']],
      ['math > inner > x', 7, 1, ['skip:unconditional:suite@7']],
      ['math > each %i', 8, 1, []],
      ['math > ctx', 9, 1, ['skip:conditional:test@9']],
      ['math > opts', 10, 1, []],
      ['pw > a', 14, 1, ['skip:environment:suite@13', 'fixme:unconditional:test@14']],
      ['focused', 16, 0, ['only:unconditional:test@16']],
      ['parked', 17, 0, ['skip:unconditional:test@17']],
    ]);
  });

  it('ignores comments, strings and look-alike calls', async () => {
    const f = await parseTestFile(
      'b.spec.ts',
      `// it.only('commented', () => {})
const s = "describe.skip('in a string', () => {})";
const re = /x/; re.test('abc');
test.step('only step', async () => {});
test.beforeEach(async () => {});
test.use({ locale: 'es' });
test('real', () => { expect(s).toContain('skip') });
`,
    );
    expect(rows(f.tests)).toEqual([['real', 7, 1, []]]);
  });

  it('parses JavaScript with JSX via the TSX grammar', async () => {
    const f = await parseTestFile('c.test.jsx', `it('renders', () => { expect(<a href="x" />).toBeTruthy() });`);
    expect(f.language).toBe('tsx');
    expect(f.parseErrors).toBe(false);
    expect(rows(f.tests)).toEqual([['renders', 1, 1, []]]);
  });

  it('flags syntax errors without losing the rest of the file', async () => {
    const f = await parseTestFile('d.test.ts', `it('ok', () => { expect(1).toBe(1) });\nit('broken', () => { expect(( });\n`);
    expect(f.parseErrors).toBe(true);
    expect(f.tests.map((t) => t.name)).toContain('ok');
  });
});

describe('Python extraction', () => {
  it('handles pytest and unittest shapes', async () => {
    const f = await parseTestFile(
      'tests/test_a.py',
      `import os, sys, unittest
import pytest
pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="x")

def test_one():
    assert 1 == 1

@pytest.mark.skip(reason="flaky")
def test_two():
    if os.environ.get("X"):
        pytest.skip("no")
    assert f() == 2

@pytest.mark.parametrize("a", [1, pytest.param(2, marks=pytest.mark.xfail)])
def test_three(a):
    assert a

class TestK:
    pytestmark = [pytest.mark.only]
    def test_m(self):
        self.assertEqual(1, 1)
    def helper(self):
        pytest.skip("not a test")

class Foo(unittest.TestCase):
    @unittest.skipUnless(sys.platform.startswith("linux"), "linux")
    def test_u(self):
        self.skipTest("x")

    @unittest.expectedFailure
    def test_v(self):
        with pytest.raises(ValueError):
            int("x")

def helper():
    pytest.skip("module helper")
`,
    );
    expect(rows(f.tests)).toEqual([
      ['test_one', 5, 1, ['skip:environment:file@3']],
      ['test_two', 9, 1, ['skip:environment:file@3', 'skip:unconditional:test@8', 'skip:environment:test@11']],
      ['test_three', 15, 1, ['skip:environment:file@3', 'xfail:unconditional:test@14']],
      ['TestK::test_m', 20, 1, ['skip:environment:file@3', 'only:unconditional:suite@19']],
      ['Foo::test_u', 27, 0, ['skip:environment:file@3', 'skip:environment:test@26', 'skip:unconditional:test@28']],
      ['Foo::test_v', 31, 1, ['skip:environment:file@3', 'xfail:unconditional:test@30']],
    ]);
  });

  it('reads module-level pytest.skip only with allow_module_level', async () => {
    const f = await parseTestFile(
      'test_b.py',
      `import pytest
if not HAVE_GPU:
    pytest.skip("needs a GPU", allow_module_level=True)

def test_x():
    assert True
`,
    );
    expect(rows(f.tests)).toEqual([['test_x', 5, 1, ['skip:conditional:file@3']]]);
  });
});

describe('test file detection', () => {
  it.each([
    ['src/a.test.ts', true],
    ['src/a.spec.tsx', true],
    ['e2e/login.e2e.js', true],
    ['src/__tests__/a.ts', true],
    ['tests/test_a.py', true],
    ['pkg/a_test.py', true],
    ['src/a.ts', false],
    ['src/types.d.ts', false],
    ['tests/conftest.py', false],
    ['README.md', false],
  ])('%s → %s', (path, expected) => {
    expect(isTestPath(path)).toBe(expected);
  });

  it('treats JS/TS under test directories as candidates', () => {
    expect(isLooseTestPath('test/helpers.ts')).toBe(true);
    expect(isLooseTestPath('spec/cart.js')).toBe(true);
    expect(isLooseTestPath('src/cart.js')).toBe(false);
    expect(isLooseTestPath('tests/helpers.py')).toBe(false);
  });
});

// Review follow-up: polarity, constants, marker kind and lexical scope.
type Flagged = [name: string, markers: string[]];

function flagged(tests: TestCase[]): Flagged[] {
  return tests.map((t) => [t.name, t.markers.map((m) => `${m.kind}${m.checked && m.kind !== 'only' ? '!' : ''}:${m.condition}@${m.line}`)]);
}

describe('marker polarity and constants', () => {
  it('TS: runIf / else / || / ternary apply when the condition is false', async () => {
    const f = await parseTestFile(
      'p.test.ts',
      `it.runIf(false)('a', () => {});
it.runIf(true)('b', () => {});
it.skipIf(true)('c', () => {});
it.skipIf(false)('d', () => {});
describe.runIf(process.platform !== 'win32')('s', () => { it('e', () => {}) });
it('f', (ctx) => { if (true) {} else { ctx.skip() } });
it('g', (ctx) => { if (false) {} else { ctx.skip() } });
it('h', (ctx) => { ready || ctx.skip() });
it('i', (ctx) => { false || ctx.skip() });
it('j', (ctx) => { true ? null : ctx.skip() });
it('k', (ctx) => { !true && ctx.skip() });
test.describe('pw', () => {
  test.skip(false, 'never');
  test.fixme(true, 'always');
  test('l', () => {});
});
`,
    );
    expect(flagged(f.tests)).toEqual([
      ['a', ['skip:unconditional@1']],
      ['b', []],
      ['c', ['skip:unconditional@3']],
      ['d', []],
      ['s > e', ['skip:environment@5']],
      ['f', []],
      ['g', ['skip:unconditional@7']],
      ['h', ['skip:conditional@8']],
      ['i', ['skip:unconditional@9']],
      ['j', []],
      ['k', []],
      ['pw > l', ['fixme:unconditional@14']],
    ]);
  });

  it('Python: skipUnless / else / elif / or / param marks apply with the right polarity', async () => {
    const f = await parseTestFile(
      'test_p.py',
      `import sys, unittest, pytest

@unittest.skipUnless(False, "x")
def test_a(): pass

@unittest.skipUnless(True, "x")
def test_b(): pass

@pytest.mark.skipif("sys.platform == 'win32'", reason="x")
def test_c(): pass

@pytest.mark.xfail(condition=False, reason="x")
def test_d(): pass

def test_e():
    if True:
        pass
    else:
        pytest.skip("x")

def test_f():
    if flag:
        pass
    elif False:
        pytest.skip("x")
    else:
        pytest.skip("y")

def test_g():
    ready or pytest.skip("x")

@pytest.mark.parametrize("n", [pytest.param(1, marks=pytest.mark.skipif(False, reason="x")), 2])
def test_h(n): pass
`,
    );
    expect(flagged(f.tests)).toEqual([
      ['test_a', ['skip:unconditional@3']],
      ['test_b', []],
      ['test_c', ['skip:environment@9']],
      ['test_d', []],
      ['test_e', []],
      ['test_f', ['skip:conditional@27']],
      ['test_g', ['skip:conditional@30']],
      ['test_h', []],
    ]);
  });
});

describe('marker kind: checked expected failures vs. hidden tests', () => {
  it('TS', async () => {
    const f = await parseTestFile(
      'k.test.ts',
      `it.fails('a', () => {});
test.failing('b', () => {});
test('c', () => { test.fail(); });
it.skip('d', () => {});
test('e', () => { test.fixme(); });
`,
    );
    expect(flagged(f.tests)).toEqual([
      ['a', ['xfail!:unconditional@1']],
      ['b', ['xfail!:unconditional@2']],
      ['c', ['xfail!:unconditional@3']],
      ['d', ['skip:unconditional@4']],
      ['e', ['fixme:unconditional@5']],
    ]);
  });

  it('Python: strict / non-strict / run=False xfail, expectedFailure, pytest.xfail()', async () => {
    const f = await parseTestFile(
      'test_k.py',
      `import unittest, pytest

@pytest.mark.xfail(strict=True)
def test_a(): pass

@pytest.mark.xfail
def test_b(): pass

@pytest.mark.xfail(strict=True, run=False)
def test_c(): pass

class T(unittest.TestCase):
    @unittest.expectedFailure
    def test_d(self): pass

def test_e():
    pytest.xfail("stop here")
`,
    );
    expect(flagged(f.tests)).toEqual([
      ['test_a', ['xfail!:unconditional@3']],
      ['test_b', ['xfail:unconditional@6']],
      ['test_c', ['xfail:unconditional@9']],
      ['T::test_d', ['xfail!:unconditional@13']],
      ['test_e', ['xfail:unconditional@17']],
    ]);
  });
});

describe('lexical scope of skip annotations', () => {
  it('TS: only markers directly in a test/describe body, an inline hook or the file top level are attributed', async () => {
    const f = await parseTestFile(
      'l.spec.ts',
      `function never() { test.skip(); }
const alsoNever = () => test.skip();
const obj = { m() { test.skip(); } };
function setup() { test.skip(); }

test.describe('s', () => {
  test.beforeEach(() => { test.fixme(); });
  test.beforeEach(setup);
  test('a', () => {});
  test('b', () => { (() => test.skip())(); });
  test('c', (ctx) => { [1].forEach(() => ctx.skip()); });
  test('d', () => { never(); });
  test('e', () => { test.skip(); });
});
describe.only('x', () => { it('y', () => {}); }); describe.only('x', () => { it('z', () => {}); });
`,
    );
    expect(flagged(f.tests)).toEqual([
      ['s > a', ['fixme:unconditional@7']],
      ['s > b', ['fixme:unconditional@7']],
      ['s > c', ['fixme:unconditional@7']],
      ['s > d', ['fixme:unconditional@7']],
      ['s > e', ['fixme:unconditional@7', 'skip:unconditional@13']],
      ['x > y', ['only:unconditional@15']],
      ['x > z', ['only:unconditional@15']],
    ]);
    expect(f.markerSites.map((s) => [s.site, s.line, s.attributed])).toEqual([
      ['/fn:never/test.skip#0', 1, false],
      ['/fn:alsoNever/test.skip#0', 2, false],
      ['/fn:m/test.skip#0', 3, false],
      ['/fn:setup/test.skip#0', 4, false],
      ['/suite:"s"/hook:test.beforeEach/test.fixme#0', 7, true],
      ['/suite:"s"/test:"b"/fn:anon/test.skip#0', 10, false],
      ['/suite:"s"/test:"c"/fn:anon/ctx.skip#0', 11, false],
      ['/suite:"s"/test:"e"/test.skip#0', 13, true],
      // Same line, same text, distinct structural ids.
      ['/suite:"x"/only#0', 15, true],
      ['/suite:"x"#1/only#0', 15, true],
    ]);
  });

  it('Python: helpers, fixtures and nested functions are census-only; setUp is an inline hook', async () => {
    const f = await parseTestFile(
      'test_l.py',
      `import pytest, unittest

def prepare():
    pytest.skip("x")

@pytest.fixture
def db():
    pytest.skip("no db")

class TestA(unittest.TestCase):
    def setUp(self):
        self.skipTest("slow")

    def test_a(self):
        pass

def test_b():
    def prepare():
        pytest.skip("inner")
    prepare()
`,
    );
    expect(flagged(f.tests)).toEqual([
      ['TestA::test_a', ['skip:unconditional@12']],
      ['test_b', []],
    ]);
    expect(f.markerSites.map((s) => [s.site, s.line, s.attributed])).toEqual([
      ['/def:prepare/skip#0', 4, false],
      ['/def:db/skip#0', 8, false],
      ['/class:TestA/def:setUp/skipTest#0', 12, true],
      ['/def:test_b/def:prepare/skip#0', 19, false],
    ]);
  });
});

describe('runner API certainty (review 3)', () => {
  it('TS: ctx.skip() / skip() are the context\'s only when they resolve to the test callback\'s parameter; any other is uncertain, never dropped', async () => {
    const f = await parseTestFile(
      'r.test.ts',
      `import { it } from 'vitest';
const outer = { skip() {} };
it('a', (ctx) => { ctx.skip(); });
it('b', ({ skip }) => { skip(); });
it('c', ({ skip: s }) => { s(); });
it('d', (ctx) => { { let ctx = { skip() {} }; ctx.skip(); } });
it('e', (ctx) => { try {} catch (ctx) { ctx.skip(); } });
it('f', (ctx) => { for (const ctx of [outer]) ctx.skip(); });
it('g', (ctx) => { if (true) { var ctx2 = outer; } ctx2.skip(); });
it('h', () => { outer.skip(); });
it('i', (context) => { context.skip(); });
it('j', ({ task }) => { task.skip(); });
it('k', { skip: onWindows }, () => {});
it('l', { only: false, todo: true }, () => {});
`,
    );
    const certainty = (tests: TestCase[]): Array<[string, string[]]> => tests.map((t) => [t.name, t.markers.map((m) => `${m.kind}:${m.condition}@${m.line}:${m.binding.certain ? 'certain' : 'uncertain'}`)]);
    expect(certainty(f.tests)).toEqual([
      ['a', ['skip:unconditional@3:certain']],
      // Destructuring the context is a one-step alias of its `skip` (round 5): at least a WARN, never certain.
      ['b', ['skip:unconditional@4:uncertain']],
      ['c', ['skip:unconditional@5:uncertain']],
      ['d', ['skip:unconditional@6:uncertain']],
      ['e', ['skip:unconditional@7:uncertain']],
      ['f', ['skip:unconditional@8:uncertain']],
      ['g', ['skip:unconditional@9:uncertain']],
      ['h', ['skip:unconditional@10:uncertain']],
      ['i', ['skip:unconditional@11:certain']],
      ['j', ['skip:unconditional@12:uncertain']],
      ['k', ['skip:conditional@13:certain']],
      ['l', ['todo:unconditional@14:certain']],
    ]);
    // Every `.skip()` call in a test is a marker site attributed to that test: none is dropped.
    expect(f.markerSites.filter((s) => s.kind === 'skip' && !s.attributed).map((s) => s.line)).toEqual([]);
  });

  it('Python: SkipTest is a skip only when raised', async () => {
    const f = await parseTestFile(
      'test_r.py',
      `import unittest
from unittest import SkipTest

class T(unittest.TestCase):
    def test_a(self):
        raise unittest.SkipTest("x")

    def test_b(self):
        raise SkipTest

    def test_c(self):
        err = unittest.SkipTest("x")
        self.assertIsInstance(err, Exception)
`,
    );
    expect(flagged(f.tests)).toEqual([
      ['T::test_a', ['skip:unconditional@6']],
      ['T::test_b', ['skip:unconditional@9']],
      ['T::test_c', []],
    ]);
    expect(f.markerSites.map((s) => s.line)).toEqual([6, 9]);
  });
});

// F7's rebinding check (docs/rules.md, *Verdicts*): only builtins' `setattr`/`delattr` on the module, on a class of the
// file or on something not resolved, a write through `globals()`/`vars()`, and `exec`/`eval` may rebind a test.
describe('what may rebind a Python test at run time', () => {
  const skipForm = async (body: string, cls = false): Promise<boolean> => {
    const src = cls
      ? `import os\nimport sys\n\nimport pytest\n\n\nclass TestX:\n    @pytest.mark.skip\n    def test_x(self):\n        assert True\n\n\n${body}\n`
      : `import os\nimport sys\n\nimport pytest\n\n\n@pytest.mark.skip\ndef test_x():\n    assert True\n\n\n${body}\n`;
    const f = await parseTestFile('test_a.py', src);
    return f.tests[0]!.markers[0]!.form.canonical;
  };

  it.each([
    ['a method named setattr (monkeypatch)', 'def helper(monkeypatch):\n    monkeypatch.setattr(os, "getcwd", lambda: "/")'],
    ['builtins setattr on an imported module', 'setattr(os, "sep", "/")'],
    ['a read through globals()', 'X = globals()["test_x"]'],
    ['a membership test on globals()', 'Y = "test_x" in globals()'],
    ['globals().get', 'Z = globals().get("test_x")'],
  ])('%s: the test is bound once', async (_why, body) => {
    expect(await skipForm(body)).toBe(true);
  });

  it.each([
    ['builtins setattr on the module', 'setattr(sys.modules[__name__], "test_x", None)'],
    ['builtins delattr on something not resolved', 'def helper(m):\n    delattr(m, "test_x")'],
    ['builtins.setattr', 'import builtins\nbuiltins.setattr(sys.modules[__name__], "test_x", None)'],
    ['a write through globals()', 'globals()["test_x"] = None'],
    ['globals().update', 'globals().update(test_x=None)'],
    ['a write through vars()', 'vars()["test_x"] = None'],
    ['exec', 'exec("test_x = None")'],
    ['eval', 'eval("1")'],
  ])('%s: the test may be rebound', async (_why, body) => {
    expect(await skipForm(body)).toBe(false);
  });

  it("builtins' setattr on a class rebinds that class's tests, not another's", async () => {
    expect(await skipForm('setattr(TestX, "test_x", None)', true)).toBe(false);
    expect(await skipForm('class Other:\n    pass\n\n\nsetattr(Other, "test_x", None)', true)).toBe(true);
  });
});
