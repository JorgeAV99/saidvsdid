// The contagion net (src/rules/contagion.ts): tokens and strings of the vocabulary, names marked to a fixed
// point by any binding (attributes and subscripts too) that holds a token or a marked name, names that hold a
// string of the vocabulary (in any container), and every new use — a call, a decorator, a raise whose callee
// holds one — at least a WARN naming its test. A normal call is an opaque frontier: its arguments count neither
// when marking nor in a callee; only by-name accesses (getattr…, Reflect.get/has, subscripts) are transparent.
import { describe, expect, it } from 'vitest';
import { contagionNet, contagionUses, newUses, type ContagionUse } from '../src/rules/contagion.js';

const T = String.fromCharCode(0x505c); // 停
const S = String.fromCharCode(0x17f); // ſ (NFKC: s)
const BS = String.fromCharCode(92);

/** The callees of the uses in a source, as the net reads them. */
async function uses(path: string, source: string): Promise<string[]> {
  return (await contagionUses(path, source, [])).map((u) => `${u.form} ${u.callee}`);
}

/** Whether one more `use` at head (the definition unchanged) is a new use of the vocabulary. */
async function oneMore(path: string, definition: string, use: string): Promise<boolean> {
  const at = async (n: number): Promise<ContagionUse[]> => contagionUses(path, `${definition}\n${use.repeat(n)}`, []);
  return newUses(await at(1), await at(2)).length > 0;
}

describe('tokens: the vocabulary read as whole identifiers, in the callee', () => {
  it('a token in the callee chain is a use: a member, a root, a literal subscript, through wrappers', async () => {
    expect(await uses('a.test.ts', "it.skip('a', () => {});\nfit('b', () => {});\nit['only']('c', () => {});\nit[('todo')]('d');\n(it as any).fails('e', () => {});\nit['skip' as const]('f', () => {});\n")).toEqual([
      'call it.skip',
      'call fit',
      "call it['only']",
      "call it[('todo')]",
      'call (itasany).fails',
      "call it['skip'asconst]",
    ]);
    expect(await uses('test_a.py', `import pytest as pt\n\n\n@pt.mark.skipif(True, reason="x")\ndef test_a():\n    pt.skip("x")\n    pyte${S}t.xfail("y")\n`)).toEqual(['decorator pt.mark.skipif', 'call pt.skip', `call pyte${S}t.xfail`]);
  });

  it('never a substring: `skip_reason`, `onlyOnce`, `skipped` are not tokens', async () => {
    expect(await uses('test_a.py', 'def skip_reason():\n    return "x"\n\n\ndef test_a():\n    skip_reason()\n    only_once()\n')).toEqual([]);
    expect(await uses('a.test.ts', "const onlyOnce = (f) => f;\nconst skipped = ['none'];\nit('a', () => { onlyOnce(() => 1)(); skipped.push('x'); });\n")).toEqual([]);
    // `éxit(` is a call of the name `éxit`, not jest's `xit`.
    expect(await uses('a.test.js', `${String.fromCharCode(0xe9)}xit('a', () => {});\n`)).toEqual([]);
  });

  it('a call is an opaque frontier: the callees of the calls a callee holds count, their arguments never', async () => {
    expect(await uses('a.test.ts', 'expect(only([1, 2], (n) => n > 1)).toEqual([2]);\nexpect(ctx.skip).toBeDefined();\nrun(it.skip, ctx.skip);\nit.each([[\'skip\'], [\'only\']])(\'x %s\', () => {});\nit.skip.each([[1]])(\'y\', () => {});\nnew Suite(it.skip).run();\n')).toEqual([
      'call only',
      'call it.skip.each([[1]])',
      'call it.skip.each',
    ]);
    expect(await uses('test_a.py', 'import pytest\n\n\ndef test_a():\n    run(pytest.skip)\n    wrap(pytest.skip)("x")\n    pytest.mark.skip(reason="x").with_args(1)\n')).toEqual([
      'call pytest.mark.skip(reason="x").with_args',
      'call pytest.mark.skip',
    ]);
  });

  it('`Reflect[\'get\']` is read like `Reflect.get`: the strings of the callee count, wherever they stand', async () => {
    expect(await uses('a.test.ts', "it('a', (ctx) => {\n  Reflect['get'](ctx, 'skip')();\n  Reflect.get(ctx, `only`)();\n  ctx[['skip'][0]]();\n});\n")).toEqual([
      "call Reflect['get'](ctx,'skip')",
      'call Reflect.get(ctx,`only`)',
      "call ctx[['skip'][0]]",
    ]);
    expect(await uses('test_a.py', 'import pytest\n\n\ndef test_a():\n    getattr(pytest, ("skip",)[0])("x")\n    vars(pytest)["xfail"]("y")\n')).toEqual(['call getattr(pytest,("skip",)[0])', 'call vars(pytest)["xfail"]']);
  });

  it('a member is read against the marked names too: `Actions.omit()`, `self.omit()`, `this.omit()`', async () => {
    expect(await oneMore('test_a.py', 'import pytest\nclass Actions:\n    omit = pytest.skip', 'def test_x():\n    Actions.omit("x")\n\n\n')).toBe(true);
    expect(await oneMore('a.test.ts', "import { it } from 'vitest';\nconst tools = { omit: it.skip };", "tools.omit('a', () => {});\n")).toBe(true);
  });

  it('a decorator, a raise and a call are read identically: a by-name access in them is transparent', async () => {
    expect(await uses('test_a.py', 'import pytest\nimport unittest\n\n\n@getattr(pytest.mark, "skip")\ndef test_a():\n    raise getattr(unittest, "SkipTest")\n\n\n@getattr(pytest.mark, "skipif")(True, reason="x")\ndef test_b():\n    getattr(pytest, "skip")("x")\n')).toEqual([
      'decorator getattr(pytest.mark,"skip")',
      'raise getattr(unittest,"SkipTest")',
      'decorator getattr(pytest.mark,"skipif")',
      'call getattr(pytest,"skip")',
    ]);
    // An ordinary call stands for its callee: its arguments are the final ones.
    expect(await uses('test_a.py', 'import pytest\n\n\n@wrap(pytest.mark.skip)\ndef test_a():\n    raise make(pytest.skip)\n')).toEqual([]);
  });

  it('best effort (coverage, not the guarantee): a class field with a literal computed name, an enum member', async () => {
    expect(await oneMore('a.test.ts', "import { it } from 'vitest';\nclass Suite { static ['omit'] = it.skip; }", "Suite.omit('a', () => {});\n")).toBe(true);
    expect(await oneMore('a.test.ts', "enum Kind { Stop = 'skip' }", "it('a', (ctx) => { ctx[Kind.Stop](); });\n")).toBe(true);
  });

  it('`SkipTest` is an exception class: a raise of it is a use, a call is not', async () => {
    expect(await uses('test_a.py', 'import unittest\n\n\ndef test_a():\n    err = unittest.SkipTest("x")\n    raise unittest.SkipTest("y")\n')).toEqual(['raise unittest.SkipTest']);
  });
});

describe('marking: a binding that holds a token, a literal equal to one, or a marked name', () => {
  it.each([
    ['an import under another name', 'from unittest import skipIf as skip_if', '@skip_if(True, "x")\ndef test_x():\n    pass\n\n\n'],
    ['an import of the token itself', 'from pytest import skip', 'def test_x():\n    skip("x")\n\n\n'],
    ['an assignment', 'import pytest\nomit = pytest.mark.skip', '@omit\ndef test_x():\n    pass\n\n\n'],
    ['an assignment through parentheses', 'import pytest\nomit = (pytest.mark.skip)', '@(omit)\ndef test_x():\n    pass\n\n\n'],
    ['a call of the form', 'import pytest\nomit = pytest.mark.skip(reason="x")', '@omit\ndef test_x():\n    pass\n\n\n'],
    ['`.__call__` behind the token', 'import pytest as pt\nomit = pt.skip.__call__', 'def test_x():\n    omit("x")\n\n\n'],
    ['an annotated assignment', 'import pytest\nomit: object = pytest.mark.skip', '@omit\ndef test_x():\n    pass\n\n\n'],
    ['an augmented assignment', 'import pytest\nomit = None\nomit += pytest.mark.skip', '@omit\ndef test_x():\n    pass\n\n\n'],
    ['a walrus', 'import pytest\n(omit := pytest.mark.skip)', '@omit\ndef test_x():\n    pass\n\n\n'],
    ['an unpacking', 'import pytest\n(omit,) = (pytest.mark.skip,)', '@omit\ndef test_x():\n    pass\n\n\n'],
    ['a for target', 'import pytest\nfor omit in (pytest.mark.skip,):\n    pass', '@omit\ndef test_x():\n    pass\n\n\n'],
    ['a with target', 'import pytest\nwith pytest.mark.skip as omit:\n    pass', '@omit\ndef test_x():\n    pass\n\n\n'],
    ['an except target', 'import unittest\ntry:\n    pass\nexcept unittest.SkipTest as stop:\n    pass', 'def test_x():\n    raise stop\n\n\n'],
    ['a parameter default', 'import pytest', 'def test_x(omit=pytest.skip):\n    omit("x")\n\n\n'],
    ['a decorated definition', 'import pytest\n@pytest.mark.skip\ndef helper():\n    pass', 'def test_x():\n    helper()\n\n\n'],
    ['a string literal equal to a token', 'import pytest\nomit = getattr(pytest, "skip")', 'def test_x():\n    omit("x")\n\n\n'],
    ['adjacent literals (joined at compile time)', 'import pytest\nomit = getattr(pytest, "sk" "ip")', 'def test_x():\n    omit("x")\n\n\n'],
    ['an escaped literal', 'import pytest\nomit = getattr(pytest, "\\x73kip")', 'def test_x():\n    omit("x")\n\n\n'],
    ['an alias of an alias (fixed point)', 'import pytest\nomit = pytest.mark.skip\nlater = omit', '@later\ndef test_x():\n    pass\n\n\n'],
    ['an import of a marked name', 'from pytest import skip as stop\nomit = stop.__call__', 'def test_x():\n    omit("x")\n\n\n'],
    ['a Unicode name', `from unittest import SkipTest as ${T}`, `def test_x():\n    raise ${T}("x")\n\n\n`],
    ['a mangled name: `@__omit` in class `TestX` is `_TestX__omit`', 'import pytest\n_TestX__omit = pytest.mark.skip\nclass TestX:\n    pass', `class TestX:\n    @__omit\n    def test_x(self):\n        pass\n\n\n`],
  ])('Python: %s', async (_name, definition, use) => {
    expect(await oneMore('test_a.py', definition, use)).toBe(true);
  });

  it.each([
    ['an import under another name', "import { fit as focus } from '@jest/globals';", "focus('a', () => {});\n"],
    ['a declaration', "import { it } from 'vitest';\nconst omit = it.skip;", "omit('a', () => {});\n"],
    ['a declaration through `as` and `!`', "import { it } from 'vitest';\nconst omit = (it.skip as typeof it.skip)!;", "omit('a', () => {});\n"],
    ['a destructured member', "import { it } from 'vitest';\nconst { skip } = it;", "skip('a', () => {});\n"],
    ['a destructured member renamed', "import { it } from 'vitest';\nconst { skip: omit } = it;", "omit('a', () => {});\n"],
    ['a literal computed key', "import { it } from 'vitest';\nconst { ['skip']: omit } = it;", "omit('a', () => {});\n"],
    ['a computed key in parentheses', "import { it } from 'vitest';\nconst { [('skip')]: omit } = it;", "omit('a', () => {});\n"],
    ['a computed key `as const`', "import { it } from 'vitest';\nconst { ['skip' as const]: omit } = it;", "omit('a', () => {});\n"],
    ['an array destructuring', "import { it } from 'vitest';\nconst [omit] = [it.skip];", "omit('a', () => {});\n"],
    ['an array destructuring default', "import { it } from 'vitest';\nconst [omit = it.skip] = [];", "omit('a', () => {});\n"],
    ['an object destructuring default', "import { it } from 'vitest';\nconst { omit = it.skip } = {};", "omit('a', () => {});\n"],
    ['`||=`', "import { it } from 'vitest';\nlet omit;\nomit ||= it.skip;", "omit('a', () => {});\n"],
    ['`??=`', "import { it } from 'vitest';\nlet omit;\nomit ??= it.skip;", "omit('a', () => {});\n"],
    ['`&&=`', "import { it } from 'vitest';\nlet omit = it;\nomit &&= it.skip;", "omit('a', () => {});\n"],
    ['an assignment', "import { it } from 'vitest';\nlet omit;\nomit = it.skip;", "omit('a', () => {});\n"],
    ['a destructuring assignment', "import { it } from 'vitest';\nlet omit;\n({ skip: omit } = it);", "omit('a', () => {});\n"],
    ['a for … of', "import { it } from 'vitest';\nlet omit;\nfor (omit of [it.skip]) break;", "omit('a', () => {});\n"],
    ['a parameter default', "import { it } from 'vitest';", "const run = (omit = it.skip) => omit('a', () => {});\n"],
    ['a string literal equal to a token, as a key', "import { it } from 'vitest';\nconst key = 'skip';", "it[key]('a', () => {});\n"],
    ['an escaped literal key', `import { it } from 'vitest';\nconst key = '${BS}u0073kip';`, "it[key]('a', () => {});\n"],
    ['a literal whose value is not certain (legacy octal)', `const key = '${BS}163kip';`, "it[key]('a', () => {});\n"],
    ['an alias of an alias (fixed point)', "import { it } from 'vitest';\nconst omit = it.skip;\nconst later = omit;", "later('a', () => {});\n"],
    ['the test context: a bound copy', '', "test('a', (t) => {\n  const omit = t.skip.bind(t);\n  omit();\n});\n"],
    ['the test context: a destructuring default', '', "test('a', (t) => {\n  const [omit = t.skip.bind(t)] = [];\n  omit();\n});\n"],
    ['the test context: `||=`', '', "test('a', (t) => {\n  let omit;\n  omit ||= t.skip.bind(t);\n  omit();\n});\n"],
    ['the test context: a computed key `as const`', '', "test('a', (ctx) => {\n  const { ['skip' as const]: omit } = ctx;\n  omit();\n});\n"],
  ])('JS/TS: %s', async (_name, definition, use) => {
    expect(await oneMore('a.test.ts', definition, use)).toBe(true);
  });

  it.each([
    ['an attribute', 'import unittest\nclass TestX(unittest.TestCase):\n    def setUp(self):\n        self.omit = self.skipTest', 'class TestX(unittest.TestCase):\n    def test_x(self):\n        self.omit("x")\n\n\n'],
    ['a subscript', 'import pytest\nd = {}\nd["k"] = pytest.skip', 'def test_x():\n    d["k"]("x")\n\n\n'],
    ['an augmented attribute', 'import pytest\nclass Box:\n    pass\nBox.omit = None\nBox.omit += pytest.mark.skip', '@Box.omit\ndef test_x():\n    pass\n\n\n'],
    ['a for target that is an attribute', 'import pytest\nclass Box:\n    pass\nfor Box.omit in (pytest.skip,):\n    pass', 'def test_x():\n    Box.omit("x")\n\n\n'],
  ])('Python: an assignment to %s marks every identifier of its target', async (_name, definition, use) => {
    expect(await oneMore('test_a.py', definition, use)).toBe(true);
  });

  it.each([
    ['`this.omit`', "import { it } from 'vitest';\nclass Suite { constructor() { this.omit = it.skip; } run() { return 1; } }", "new Suite().omit('a', () => {});\n"],
    ['a subscript', "import { it } from 'vitest';\nconst d = {};\nd['k'] = it.skip;", "d['k']('a', () => {});\n"],
    ['a class field', "import { it } from 'vitest';\nclass Suite { static omit = it.skip; }", "Suite.omit('a', () => {});\n"],
    ['a private class field', "import { it } from 'vitest';\nclass Suite { static #omit = it.skip; static run() { Suite.#omit('a', () => {}); } }", ''],
  ])('JS/TS: an assignment to %s marks every identifier of its target', async (_name, definition, use) => {
    if (use === '') {
      // The use stands in the definition: the definition is new at head.
      const at = (d: string): Promise<ContagionUse[]> => contagionUses('a.test.ts', d, []);
      expect(newUses(await at("import { it } from 'vitest';\nclass Suite { static #omit = it.only; }"), await at(definition)).length).toBeGreaterThan(0);
      return;
    }
    expect(await oneMore('a.test.ts', definition, use)).toBe(true);
  });

  it('a name built at run time is coverage, not a guarantee (`"sk" + "ip"`, a template, an f-string with a substitution)', async () => {
    expect(await oneMore('test_a.py', 'import pytest\nomit = getattr(pytest, "sk" + "ip")', 'def test_x():\n    omit("x")\n\n\n')).toBe(false);
    expect(await oneMore('test_a.py', 'import pytest\nk = "ip"\nomit = getattr(pytest, f"sk{k}")', 'def test_x():\n    omit("x")\n\n\n')).toBe(false);
    expect(await oneMore('a.test.ts', "import { it } from 'vitest';\nconst k = 'ip';\nconst key = `sk${k}`;", "it[key]('a', () => {});\n")).toBe(false);
    // A value that enters a function is behind an opaque frontier: what the call returns holds nothing.
    expect(await oneMore('test_a.py', 'import os\nimport pytest\nk = os.environ.get("MODE", "skip")', 'def test_x():\n    getattr(pytest, k)("x")\n\n\n')).toBe(false);
    expect(await oneMore('a.test.ts', "import { it } from 'vitest';\nconst wrap = (f: unknown) => f;\nconst omit = wrap(it.skip);", "omit('a', () => {});\n")).toBe(false);
    // What a function returns is computed when it runs: a function is not a container.
    expect(await oneMore('a.test.ts', "const key = () => 'skip';", "it('a', (ctx) => { ctx[key()](); });\n")).toBe(false);
    expect(await oneMore('test_a.py', 'import pytest\nkey = lambda: "skip"', 'def test_x():\n    getattr(pytest, key())("x")\n\n\n')).toBe(false);
  });

  it("a token is a key of the vocabulary's own table: `toString`, `constructor`, `hasOwnProperty` are not", async () => {
    expect(await uses('a.test.ts', "x.toString();\nx.constructor();\nObject.prototype.hasOwnProperty.call(x, 'a');\nx['valueOf']();\n")).toEqual([]);
    expect(await uses('test_a.py', 'x.__init__()\nx.toString()\n')).toEqual([]);
  });

  it('a literal is a token only when it equals one: `"uncertain"`, `"skipped"` are not', async () => {
    expect(await oneMore('a.test.ts', "const certainty = 'uncertain';\nconst label = 'skipped';", 'certainty.trim();\nlabel.trim();\n')).toBe(false);
  });

  it('a type holds nothing at run time: a string or a token in a type marks nothing', async () => {
    expect(await oneMore('a.test.ts', "const run = (kind?: 'skip' | 'only'): string => String(kind);\nconst x = 1 as unknown as typeof it.skip;", "run();\nx();\n")).toBe(false);
  });

  it('a binding that holds no token marks nothing', async () => {
    expect(await oneMore('test_a.py', 'import pytest\nomit = pytest.mark.parametrize', '@omit("x", [1])\ndef test_x(x):\n    pass\n\n\n')).toBe(false);
    expect(await oneMore('a.test.ts', "import { it } from 'vitest';\nconst run = it;", "run('a', () => {});\n")).toBe(false);
  });
});

describe('a name that holds a string of the vocabulary, in any container, counts in a callee', () => {
  it.each([
    ['a subscript', "import { it } from 'vitest';\nconst key = 'skip';", "it[key]('a', () => {});\n"],
    ['`Reflect.get`', "import { it } from 'vitest';\nconst key = 'skip';", "Reflect.get(it, key)('a', () => {});\n"],
    ['a computed key in a destructuring', "import { it } from 'vitest';\nconst key = 'skip';\nconst { [key]: omit } = it;", "omit('a', () => {});\n"],
    ['`Reflect.has` elsewhere in the file', "import { it } from 'vitest';\nconst key = 'skip';\nReflect.has(it, key);\nconst omit = it[key];", "omit('a', () => {});\n"],
    ['through another name (`k2 = key`, then `it[k2]`)', "import { it } from 'vitest';\nconst key = 'skip';\nconst k2 = key;", "it[k2]('a', () => {});\n"],
    ['an array', "const keys = ['skip'];", "it('a', (ctx) => { ctx[keys[0]](); });\n"],
    ['an object, at any depth', "const table = { a: { key: 'only' } };", "test[table.a.key]('a', () => {});\n"],
    ['a conditional', "const key = process.env.X ? 'skip' : 'run';", "it[key]('a', () => {});\n"],
    ['through another container', "const keys = ['skip'];\nconst all = [keys];", "it[all[0][0]]('a', () => {});\n"],
  ])('JS/TS: %s', async (_name, definition, use) => {
    expect(await oneMore('a.test.ts', definition, use)).toBe(true);
  });

  it.each([
    ['`getattr`', 'import pytest\nk = "skip"', 'def test_x():\n    getattr(pytest, k)("x")\n\n\n'],
    ['`hasattr` elsewhere in the file', 'import pytest\nk = "skip"\nhasattr(pytest, k)\nomit = getattr(pytest, k)', 'def test_x():\n    omit("x")\n\n\n'],
    ['a subscript', 'import pytest\nk = "skip"\nmarks = vars(pytest.mark)\nomit = marks[k]', '@omit\ndef test_x():\n    pass\n\n\n'],
    ['a list', 'import pytest\nkeys = ["skip"]', 'def test_x():\n    getattr(pytest, keys[0])("x")\n\n\n'],
    ['a tuple', 'import pytest\nkeys = ("skip",)', 'def test_x():\n    getattr(pytest, keys[0])("x")\n\n\n'],
    ['a dict', 'import pytest\nkeys = {"a": "xfail"}', 'def test_x():\n    getattr(pytest, keys["a"])("x")\n\n\n'],
    ['a set, through a for target', 'import pytest\nkeys = {"skip"}', 'def test_x():\n    for k in keys:\n        getattr(pytest, k)("x")\n\n\n'],
    ['a class attribute', 'import pytest\nclass Kinds:\n    SKIP = "skip"', 'def test_x():\n    getattr(pytest, Kinds.SKIP)("x")\n\n\n'],
  ])('Python: %s', async (_name, definition, use) => {
    expect(await oneMore('test_a.py', definition, use)).toBe(true);
  });

  it('a string in the callee counts as it stands: `getattr(pytest, "skip")(…)`, `Reflect.get(it, \'skip\')(…)`', async () => {
    expect(await uses('test_a.py', 'import pytest\n\n\ndef test_a():\n    getattr(pytest, "skip")("x")\n')).toEqual(['call getattr(pytest,"skip")']);
    expect(await uses('a.test.ts', "Reflect.get(it, 'skip')('a', () => {});\n")).toEqual(["call Reflect.get(it,'skip')"]);
  });

  it.each([
    ['a constant compared and passed on', "const kind = 'skip';\nconst check = (k: string) => k === kind;", "check(kind);\n"],
    ['a parameter default', "const statusOf = (k = 'skip') => k.toUpperCase();", "statusOf();\n"],
    ['a table of cases', "const GOOD = { path: ['pytest', 'mark', 'skip'] };\nconst broken = (p: object) => ({ ...GOOD, ...p });", "broken({});\n"],
    ['a builder of data', "const u = (callee: string) => ({ callee, token: 'skip' });", "u('omit');\n"],
    ['the final argument of a call (`procesar(kind)`)', "const kind = 'skip';\nconst procesar = (k: string) => k.toUpperCase();", "procesar(kind);\n"],
    ['an argument of a call the callee holds (`expect(statusOf(kind)).toBe(…)`)', "const kind = 'skip';\nconst statusOf = (k: string) => k.toUpperCase();", "expect(statusOf(kind)).toBe('SKIP');\n"],
    ['a row of an `it.each` table', "import { it } from 'vitest';", "it.each([['skip'], ['only']])('x %s', (w) => {});\n"],
    ['a call\'s result (`r = f(GOOD)`, then `r.x`)', "const GOOD = { status: 'skip' };\nconst f = (x: object) => x;\nconst r = f(GOOD);", "expect(r.status).toBe('skip');\nr.toString();\n"],
  ])('JS/TS: data, never in a callee: %s — not a use', async (_name, definition, use) => {
    expect(await oneMore('a.test.ts', definition, use)).toBe(false);
  });

  it.each([
    ['a constant and a default', 'KIND = "skip"\nstatus_of = lambda kind=KIND: kind.upper()', 'def test_x():\n    status_of()\n\n\n'],
    ['a table of cases', 'CASES = [{"status": "skip"}]\nfirst = lambda cases=CASES: cases[0]', 'def test_x():\n    first()\n\n\n'],
    ['the final argument of a call (`procesar(kind)`)', 'kind = "skip"\ndef procesar(k):\n    return k.upper()', 'def test_x():\n    procesar(kind)\n\n\n'],
    ['a call\'s result (`r = check(GOOD)`, then `r.get(…)`)', 'GOOD = {"status": "skip"}\ndef check(x):\n    return dict(x)\nr = check(GOOD)', 'def test_x():\n    r.get("ok")\n\n\n'],
  ])('Python: data, never in a callee: %s — not a use', async (_name, definition, use) => {
    expect(await oneMore('test_a.py', definition, use)).toBe(false);
  });
});

describe('new uses and findings', () => {
  it('a use is new at head when base has fewer of it, by form, callee and test', () => {
    const u = (callee: string, test: string | null): ContagionUse => ({ form: 'call', callee, line: 1, calleeEnd: 1, test, mark: { kinds: new Set(['skip']), token: 'skip', string: null, via: null } });
    expect(newUses([u('omit', 'a')], [u('omit', 'a'), u('omit', 'b')]).map((x) => x.test)).toEqual(['b']);
    expect(newUses([u('omit', 'a')], [u('omit', 'a')])).toEqual([]);
    expect(newUses([], [u('omit', 'a'), u('omit', 'a')])).toHaveLength(2);
  });

  it('a definition that becomes marked makes its unchanged uses new', async () => {
    const at = (value: string): string => `import pytest\nlater = ${value}\n\n\n@later\ndef test_x():\n    pass\n`;
    expect(newUses(await contagionUses('test_a.py', at('print'), []), await contagionUses('test_a.py', at('pytest.mark.skip'), []))).toHaveLength(1);
  });

  it('warns once per line, names the test, defers to a finding of the extractor on the use, and follows the selected rules', async () => {
    const base = "import { it } from 'vitest';\nconst omit = it.skip;\nconst solo = it.only;\nit('a', () => {});\nit('b', () => {});\n";
    const head = "import { it } from 'vitest';\nconst omit = it.skip;\nconst solo = it.only;\nomit('a', () => {});\nsolo('b', () => {});\n";
    const tests = [
      { line: 4, name: 'a', declared: 'a' },
      { line: 5, name: 'b', declared: 'b' },
    ];
    const file = { basePath: 'a.test.ts', headPath: 'a.test.ts', base, head, baseTests: tests, headTests: tests };
    const all = await contagionNet([file], ['TG002', 'TG003'], () => false);
    expect(all.map((f) => [f.rule, f.severity, f.line, f.test])).toEqual([
      ['TG003', 'warn', 4, 'a'],
      ['TG002', 'warn', 5, 'b'],
    ]);
    expect(all[0]!.message).toBe('Adds a call of `omit` to test "a": `omit` is bound at line 2 to a value that holds `skip`, a token of the skip/focus vocabulary; it may skip it');
    expect((await contagionNet([file], ['TG002', 'TG003'], (_f, from) => from === 4)).map((f) => f.line)).toEqual([5]);
    expect((await contagionNet([file], ['TG003'], () => false)).map((f) => f.rule)).toEqual(['TG003']);
  });

  it('words a string as a string: in the callee, or held by a name', async () => {
    const base = "import { it } from 'vitest';\nconst keys = ['skip'];\nit('a', (ctx) => {});\nit('b', (ctx) => {});\n";
    const head = "import { it } from 'vitest';\nconst keys = ['skip'];\nit('a', (ctx) => { ctx[keys[0]](); });\nit('b', (ctx) => { Reflect['has'](ctx, 'skip')(); });\n";
    const tests = [
      { line: 3, name: 'a', declared: 'a' },
      { line: 4, name: 'b', declared: 'b' },
    ];
    const file = { basePath: 'a.test.ts', headPath: 'a.test.ts', base, head, baseTests: tests, headTests: tests };
    expect((await contagionNet([file], ['TG002', 'TG003'], () => false)).map((f) => f.message)).toEqual([
      "Adds a call of `ctx[keys[0]]` to test \"a\": `keys` is bound at line 2 to a value that holds the string `'skip'`, a member's name in the skip/focus vocabulary; it may skip it",
      // `Reflect.has` tests the member and returns no member: transparent, its literal name read as a string
      // (`Reflect.get(ctx, 'skip')` is the member `ctx.skip`, a token: test/normalise.test.ts).
      "Adds a call of `Reflect['has'](ctx,'skip')` to test \"b\": its callee holds the string `'skip'`, a member's name in the skip/focus vocabulary; it may skip it",
    ]);
  });
});
