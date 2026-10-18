// Attribution: the runner's API by binding (docs/rules.md; src/parse/ts-binding.ts, src/parse/py-binding.ts).
// Under the documented assumption that the framework is not patched at run time, and read by the
// languages' own tooling:
// - JS/TS: certain only when the TypeScript compiler's local symbol for the name has exactly one
//   declaration, a static import of vitest, @jest/globals, @playwright/test or node:test (named,
//   aliased or a namespace, escapes decoded), and only for a form that runner's API has;
// - Python: the rule is about the whole file (Python's ast and symtable): certain only when the file
//   binds the name exactly once, by a module-level import of pytest/unittest, and no other symbol
//   table binds it (not mangled, implicit or a builtin; no star import) — then wherever it is used, a
//   decorator or a test body; `self.<method>` only through a certain unittest.TestCase chain in a file
//   that binds the method's name nowhere; a one-step alias is read, uncertain; mutation is outside the
//   assumption (only evident direct writes on the import are a courtesy WARN);
// - everything else shaped like the vocabulary is uncertain: the rules warn ("may …"), never FAIL,
//   never silence. There is no class "certainly not the runner's": nothing shaped like a marker is dropped.
import { describe, expect, it } from 'vitest';
import { parseTestFile } from '../src/parse/index.js';

type Seen = 'certain' | 'uncertain' | 'none';
const BS = String.fromCharCode(92);

/** What the extractor makes of the marker of `kind` on the test whose name ends in "t". */
async function marker(path: string, source: string, kind: 'skip' | 'only' | 'todo' | 'xfail' | 'fixme' = 'skip'): Promise<Seen> {
  const f = await parseTestFile(path, source);
  const t = f.tests.find((x) => x.name.endsWith('t'));
  const m = t?.markers.find((x) => x.kind === kind);
  return !m ? 'none' : m.binding.certain ? 'certain' : 'uncertain';
}
const ts = (source: string, kind?: 'skip' | 'only' | 'todo' | 'xfail' | 'fixme'): Promise<Seen> => marker('a.test.ts', source, kind);
const py = (source: string, kind?: 'skip' | 'only' | 'xfail'): Promise<Seen> => marker('test_a.py', source, kind);
const body = "('t', () => { expect(1).toBe(1); });";

describe('JavaScript / TypeScript', () => {
  it.each([
    // certain: a static import of a runner, declared nowhere else
    ['a named import from vitest', `import { it } from 'vitest';\nit.skip${body}`, 'certain'],
    ['an aliased import (`test as it`)', `import { test as it } from 'vitest';\nit.skip${body}`, 'certain'],
    ['an import under another name (`it as check`)', `import { it as check } from 'vitest';\ncheck.skip${body}`, 'certain'],
    ['a string import name', `import { "it" as check } from 'vitest';\ncheck.skip${body}`, 'certain'],
    ['an import from @jest/globals', `import { it } from '@jest/globals';\nit.skip${body}`, 'certain'],
    ['an import from node:test', `import { it } from 'node:test';\nit.skip${body}`, 'certain'],
    ['vitest\'s namespace', `import * as v from 'vitest';\nv.it.skip${body}`, 'certain'],
    ['vitest\'s namespace, literal subscripts', `import * as v from 'vitest';\nv['it']['skip']${body}`, 'certain'],
    ['an escaped module name', `import { it } from '${BS}u0076itest';\nit.skip${body}`, 'certain'],
    ['an escaped identifier', `import { it } from 'vitest';\n${BS}u0069t.skip${body}`, 'certain'],
    ['an escaped property', `import { it } from 'vitest';\nit.${BS}u0073kip${body}`, 'certain'],
    ['a literal subscript (case D)', `import { it } from 'vitest';\nit['skip']${body}`, 'certain'],
    ['an escaped literal subscript (case D)', `import { it } from 'vitest';\nit['${BS}u0073kip']${body}`, 'certain'],
    ['a template literal subscript', `import { it } from 'vitest';\nit[\`skip\`]${body}`, 'certain'],
    ['the runner mutated through a dynamic import (outside the assumption: not detected)', `import { test } from 'node:test';\n(await import('node:test')).default.skip = (n, f) => test(n, f);\ntest.skip${body}`, 'certain'],
    ['the runner mutated through `globalThis` (outside the assumption: not detected)', `import { it } from 'vitest';\nconst g = it;\ng.skip = (n, f) => it(n, f);\nit.skip${body}`, 'certain'],
    ['a `var` in a `for` of another function', `import { it } from 'vitest';\nfunction other() {\n  for (var it of xs) {}\n}\nit.skip${body}`, 'certain'],
    ['a Playwright `test` extended under another name', `import { test } from '@playwright/test';\nconst my = test.extend({});\ntest.skip${body}`, 'certain'],
    ['a shadow in a block that does not enclose the use', `import { it } from 'vitest';\n{\n  const it = makeIt();\n}\nit.skip${body}`, 'certain'],
    ['parentheses and `as` around the import', `import { it } from 'vitest';\n(it as any).skip${body}`, 'certain'],
    ['a non-null assertion', `import { it } from 'vitest';\nit!.skip${body}`, 'certain'],
    ['a namespace of another name', `import { it } from 'vitest';\nnamespace Helpers { export const it = 1; }\nit.skip${body}`, 'certain'],
    // uncertain: a global (never certain, whatever the configuration)
    ['a global', `it.skip${body}`, 'uncertain'],
    ['a global through a literal subscript', `it['skip']${body}`, 'uncertain'],
    // uncertain: a declaration in a scope around the use
    ['an object literal', `const it = { skip: (name, fn) => fn() };\nit.skip${body}`, 'uncertain'],
    ['a function declaration', `function it() {}\nit.skip${body}`, 'uncertain'],
    ['a block const around the use', `{\n  const it = { skip: (n, f) => f() };\n  it.skip${body}\n}`, 'uncertain'],
    ['an alias of the import', `import { test } from 'vitest';\nconst it = test;\nit.skip${body}`, 'uncertain'],
    ['a var hoisted from a block', `if (x) { var it = makeIt(); }\nit.skip${body}`, 'uncertain'],
    ['imported from vitest and also declared', `import { it } from 'vitest';\nif (x) { var it = 1; }\nit.skip${body}`, 'uncertain'],
    ['imported and shadowed in an enclosing block', `import { it } from 'vitest';\n{\n  const it = makeIt();\n  it.skip${body}\n}`, 'uncertain'],
    ['a parameter of a describe callback', `import { describe } from 'vitest';\ndescribe('s', (it) => {\n  it.skip${body}\n});`, 'uncertain'],
    ['a catch parameter', `try {} catch (it) {\n  it.skip${body}\n}`, 'uncertain'],
    ['a for-of variable', `for (const it of runners) {\n  it.skip${body}\n}`, 'uncertain'],
    ['an exported declaration', `export const it = makeIt();\nit.skip${body}`, 'uncertain'],
    ['a TS enum', `enum it { skip }\nit.skip${body}`, 'uncertain'],
    ['a top-level namespace (an expression statement)', `import { it } from 'vitest';\nnamespace it { export const skip = 1; }\nit.skip${body}`, 'uncertain'],
    ['`import it = Helpers.api` in a namespace', `import { it } from 'vitest';\nnamespace Suite {\n  import it = Helpers.api;\n  it.skip${body}\n}`, 'uncertain'],
    ['a namespace block of the same name exporting `it`', `import { it } from 'vitest';\nnamespace Suite {\n  export const it = make();\n}\nnamespace Suite {\n  it.skip${body}\n}`, 'uncertain'],
    ['a function signature', `import { it } from 'vitest';\nfunction it(): void;\nit.skip${body}`, 'uncertain'],
    ['inside a `with` (dynamic scope)', `import { it } from 'vitest';\nwith (obj) {\n  it.skip${body}\n}`, 'uncertain'],
    ['written by an assignment', `import { it } from 'vitest';\nit = other;\nit.skip${body}`, 'uncertain'],
    ['a `var` in a `for` hoisted to the module', `for (var it of runners) {}\nit.skip${body}`, 'uncertain'],
    ['a Playwright `test` from `extend` (a test API of its own)', `import { test as base } from '@playwright/test';\nconst test = base.extend({});\ntest.skip${body}`, 'uncertain'],
    // uncertain: a one-step alias of the vocabulary, read as what it aliases (never silence)
    ['`const omit = it.skip`', `import { it } from 'vitest';\nconst omit = it.skip;\nomit${body}`, 'uncertain'],
    ['`const [omit] = [it.skip]` (unpacking)', `import { it } from 'vitest';\nconst [omit] = [it.skip];\nomit${body}`, 'uncertain'],
    ['`const { skip: omit } = it` (destructuring a member)', `import { it } from 'vitest';\nconst { skip: omit } = it;\nomit${body}`, 'uncertain'],
    ['`const { skip } = it` (destructuring a member)', `import { it } from 'vitest';\nconst { skip } = it;\nskip${body}`, 'uncertain'],
    ['`const skipWin = it.skipIf(cond)`', `import { it } from 'vitest';\nconst skipWin = it.skipIf(process.platform === 'win32');\nskipWin${body}`, 'uncertain'],
    ['an alias in a describe callback', `import { describe, it } from 'vitest';\ndescribe('s', () => {\n  const omit = it.skip;\n  omit${body}\n});`, 'uncertain'],
    // uncertain, a courtesy outside the assumption: an evident direct write on the imported name
    ['`it.skip = …`', `import { it } from 'vitest';\nit.skip = (n, f) => it(n, f);\nit.skip${body}`, 'uncertain'],
    ['`delete it.only`', `import { it } from 'vitest';\ndelete it.only;\nit.skip${body}`, 'uncertain'],
    ['`Object.defineProperty(test, …)`', `import { test } from 'node:test';\nObject.defineProperty(test, 'skip', { value: test });\ntest.skip${body}`, 'uncertain'],
    ['`Object.assign(it, …)`', `import { it } from 'vitest';\nObject.assign(it, { skip: it });\nit.skip${body}`, 'uncertain'],
    ['`Reflect.set(v.it, …)` on a namespace', `import * as v from 'vitest';\nReflect.set(v.it, 'skip', v.it);\nv.it.skip${body}`, 'uncertain'],
    // uncertain: not a static named or namespace import of a runner
    ['a re-export from the project', `import { it } from './support';\nit.skip${body}`, 'uncertain'],
    ['a callee shaped like the runner\'s through a project namespace', `import * as h from './support';\nh.it.skip${body}`, 'uncertain'],
    ['destructuring a require of vitest', `const { it } = require('vitest');\nit.skip${body}`, 'uncertain'],
    ['a require of vitest as a namespace', `const v = require('vitest');\nv.it.skip${body}`, 'uncertain'],
    ['destructuring vitest\'s namespace', `import * as v from 'vitest';\nconst { it } = v;\nit.skip${body}`, 'uncertain'],
    ['a dynamic import', `const { it } = await import('vitest');\nit.skip${body}`, 'uncertain'],
    ['a default import', `import test from 'node:test';\ntest.skip${body}`, 'uncertain'],
    ['a type-only import', `import type { it } from 'vitest';\nit.skip${body}`, 'uncertain'],
    ['an inline type-only import', `import { type it } from 'vitest';\nit.skip${body}`, 'uncertain'],
    ['import = require', `import v = require('vitest');\nv.it.skip${body}`, 'uncertain'],
    ['another export under the name `it`', `import { vi as it } from 'vitest';\nit.skip${body}`, 'uncertain'],
  ] as const)('%s', async (_why, source, want) => {
    expect(await ts(source)).toBe(want);
  });

  it.each([
    ['jest\'s `failing` on vitest\'s `it`', `import { it } from 'vitest';\nit.failing${body}`, 'xfail', 'uncertain'],
    ['jest\'s `failing` on jest\'s `it`', `import { it } from '@jest/globals';\nit.failing${body}`, 'xfail', 'certain'],
    ['Playwright\'s `fixme`', `import { test } from '@playwright/test';\ntest.fixme${body}`, 'fixme', 'certain'],
    ['`fixme` on vitest\'s `test`', `import { test } from 'vitest';\ntest.fixme${body}`, 'fixme', 'uncertain'],
    ['`todo` on Playwright\'s `test`', `import { test } from '@playwright/test';\ntest.todo('t');`, 'todo', 'uncertain'],
    ['jest\'s `fit`', `import { fit } from '@jest/globals';\nfit${body}`, 'only', 'certain'],
    ['`fit` from vitest, which does not export it', `import { fit } from 'vitest';\nfit${body}`, 'only', 'uncertain'],
    ['node:test\'s `only` needs --test-only', `import { it } from 'node:test';\nit.only${body}`, 'only', 'uncertain'],
    ['vitest\'s `only`', `import { it } from 'vitest';\nit.only${body}`, 'only', 'certain'],
    ['`const solo = test.only`, a one-step alias', `import { test } from 'vitest';\nconst solo = test.only;\nsolo${body}`, 'only', 'uncertain'],
    ['vitest options', `import { it } from 'vitest';\nit('t', { skip: true }, () => {});`, 'skip', 'certain'],
    ['jest has no options object', `import { it } from '@jest/globals';\nit('t', { skip: true }, () => {});`, 'skip', 'uncertain'],
  ] as const)('%s', async (_why, source, kind, want) => {
    expect(await ts(source, kind)).toBe(want);
  });

  it.each([
    ['the context of a vitest test', `import { it } from 'vitest';\nit('t', (ctx) => { ctx.skip(); });`, 'certain'],
    ['the context through a literal subscript', `import { it } from 'vitest';\nit('t', (ctx) => { ctx['skip'](); });`, 'certain'],
    ['the destructured context (a one-step alias of its `skip`)', `import { it } from 'vitest';\nit('t', ({ skip }) => { skip(); });`, 'uncertain'],
    ['node:test\'s `t.skip()`', `import { test } from 'node:test';\ntest('t', (t) => { t.skip(); });`, 'certain'],
    ['the context of a global `it`', `it('t', (ctx) => { ctx.skip(); });`, 'uncertain'],
    ['jest passes `done`, not a context', `import { it } from '@jest/globals';\nit('t', (ctx) => { ctx.skip(); });`, 'uncertain'],
    ['a local object shadowing the context', `import { it } from 'vitest';\nit('t', (ctx) => { { const ctx = { skip() {} }; ctx.skip(); } });`, 'uncertain'],
    ['a local object, no context parameter', `import { it } from 'vitest';\nit('t', () => { const ctx = { skip() {} }; ctx.skip(); });`, 'uncertain'],
    ['the context reassigned', `import { it } from 'vitest';\nit('t', (ctx) => { ctx = other; ctx.skip(); });`, 'uncertain'],
    ['the context redeclared with var', `import { it } from 'vitest';\nit('t', (ctx) => { var ctx = other; ctx.skip(); });`, 'uncertain'],
    ['a bare `skip()` that is not the context\'s', `import { it } from 'vitest';\nit('t', () => { skip(); });`, 'uncertain'],
    ['the context of a vitest hook', `import { beforeEach, describe, it } from 'vitest';\ndescribe('s', () => {\n  beforeEach((ctx) => { ctx.skip(); });\n  it('t', () => {});\n});`, 'certain'],
    ['the context of a global hook', `import { describe, it } from 'vitest';\ndescribe('s', () => {\n  beforeEach((ctx) => { ctx.skip(); });\n  it('t', () => {});\n});`, 'uncertain'],
    ['Playwright\'s annotation', `import { test } from '@playwright/test';\ntest('t', async ({ page }) => { test.skip(); });`, 'certain'],
    ['an annotation on vitest\'s `test`', `import { test } from 'vitest';\ntest('t', async () => { test.skip(); });`, 'uncertain'],
  ] as const)('%s', async (_why, source, want) => {
    expect(await ts(source)).toBe(want);
  });

  it('a suite declared through an uncertain callee makes its tests and their markers uncertain', async () => {
    const f = await parseTestFile('a.test.ts', `import { it } from 'vitest';\ndescribe('s', () => {\n  it.skip('t', () => {});\n});`);
    expect(f.tests.map((t) => [t.name, t.binding.certain, t.markers[0]?.binding.certain])).toEqual([['s > t', false, false]]);
  });

  it('a test declared inside a function may never be declared', async () => {
    const f = await parseTestFile('a.test.ts', `import { it } from 'vitest';\n[1].forEach(() => {\n  it('t', () => {});\n});\nit('u', () => {});`);
    expect(f.tests.map((t) => [t.name, t.binding.certain])).toEqual([['t', false], ['u', true]]);
  });

  it('a callee shaped like the test API through a namespace declares a test only with a name', async () => {
    const f = await parseTestFile('a.test.ts', `import { it } from 'vitest';\nhelpers.it(rows, () => {});\nhelpers.it('t', () => {});\nit('u', () => {});`);
    expect(f.tests.map((t) => [t.name, t.binding.certain])).toEqual([['t', false], ['u', true]]);
  });

  it('assertions: certain from a runner or an assertion library; a global or a local one may not assert', async () => {
    const asserts = async (source: string): Promise<boolean[]> => (await parseTestFile('a.test.ts', source)).tests[0]!.assertionSites.map((a) => a.binding.certain);
    expect(await asserts(`import { expect, it } from 'vitest';\nit('t', () => { expect(1).toBe(1); });`)).toEqual([true]);
    expect(await asserts(`import { expect } from 'chai';\nimport { it } from 'vitest';\nit('t', () => { expect(1).to.equal(1); });`)).toEqual([true]);
    expect(await asserts(`import assert from 'node:assert';\nimport { it } from 'node:test';\nit('t', () => { assert.equal(1, 1); });`)).toEqual([true]);
    expect(await asserts(`import { strict as assert } from 'node:assert';\nimport { it } from 'node:test';\nit('t', () => { assert.equal(1, 1); });`)).toEqual([true]);
    expect(await asserts(`import sinon from 'sinon';\nimport { it } from 'vitest';\nit('t', () => { sinon.assert.calledOnce(spy); });`)).toEqual([true]);
    expect(await asserts(`import { it } from 'vitest';\nit('t', () => { expect(1).toBe(1); });`)).toEqual([false]);
    expect(await asserts(`import { it } from 'vitest';\nconst expect = (v) => ({ toBe: () => {} });\nit('t', () => { expect(1).toBe(1); });`)).toEqual([false]);
    expect(await asserts(`import { it } from 'vitest';\nimport { expect } from './fixtures';\nit('t', () => { expect(1).toBe(1); });`)).toEqual([false]);
    expect(await asserts(`import { it } from 'node:test';\nit('t', (t) => { t.assert.ok(1); });`)).toEqual([false]);
  });
});

describe('Python', () => {
  it.each([
    // certain: a module-level import nothing in the module rebinds, wherever it is used
    ['`import pytest`, a decorator', 'import pytest\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'certain'],
    ['`import pytest as pt`', 'import pytest as pt\n\n\n@pt.mark.skip\ndef test_t():\n    pass\n', 'certain'],
    ['`from pytest import mark`', 'from pytest import mark\n\n\n@mark.skip\ndef test_t():\n    pass\n', 'certain'],
    ['`from pytest import mark as m`', 'from pytest import mark as m\n\n\n@m.skip\ndef test_t():\n    pass\n', 'certain'],
    ['`from unittest import skipIf as skip_if`', 'from unittest import skipIf as skip_if\n\n\n@skip_if(True, "x")\ndef test_t():\n    pass\n', 'certain'],
    ['`import unittest`, a method decorator', 'import unittest\n\n\nclass TestA(unittest.TestCase):\n    @unittest.skip("x")\n    def test_t(self):\n        pass\n', 'certain'],
    ['`pytestmark` at module level', 'import pytest\n\npytestmark = pytest.mark.skip\n\n\ndef test_t():\n    pass\n', 'certain'],
    ['`pytest.skip(allow_module_level=True)` at module level', 'import pytest\n\npytest.skip("x", allow_module_level=True)\n\n\ndef test_t():\n    pass\n', 'certain'],
    ['`pytest.param(marks=…)` in a decorator', 'import pytest\n\n\n@pytest.mark.parametrize("x", [pytest.param(1, marks=pytest.mark.skip)])\ndef test_t(x):\n    pass\n', 'certain'],
    ['`pytest.skip()` in the test body', 'import pytest\n\n\ndef test_t():\n    pytest.skip("x")\n', 'certain'],
    ['`skip()` from `from pytest import skip` in the test body', 'from pytest import skip\n\n\ndef test_t():\n    skip("x")\n', 'certain'],
    ['`raise unittest.SkipTest` in the test body', 'import unittest\n\n\ndef test_t():\n    raise unittest.SkipTest("x")\n', 'certain'],
    ['`pytest.skip()` in `setup_method`', 'import pytest\n\n\nclass TestA:\n    def setup_method(self):\n        pytest.skip("x")\n\n    def test_t(self):\n        pass\n', 'certain'],
    ['`import pyteſt` (NFKC: the module `pytest`)', 'import pyte' + String.fromCharCode(0x17f) + 't\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'certain'],
    ['`pytest.mark.ſkip` (NFKC: `skip`)', 'import pytest\n\n\n@pytest.mark.' + String.fromCharCode(0x17f) + 'kip\ndef test_t():\n    pass\n', 'certain'],
    ['a Unicode alias at module level', 'from unittest import SkipTest as ' + String.fromCharCode(0x505c) + '\n\n\ndef test_t():\n    raise ' + String.fromCharCode(0x505c) + '("x")\n', 'certain'],
    // certain: symtable's classification, as it is — global (declared or implicit) and nothing else, in every other table
    ['`global` declared with no binding (symtable: the module\'s global)', 'import pytest\n\n\ndef helper():\n    global pytest\n    return pytest\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'certain'],
    ['used in a nested function and a lambda (implicit globals)', 'import pytest\n\n\ndef helper():\n    def inner():\n        return pytest\n    return lambda: pytest\n\n\ndef test_t():\n    pytest.skip("x")\n', 'certain'],
    // certain: mutation is outside the assumption and not detected (no direct write on the import)
    ['reflection (`globals()`)', 'import pytest\n\nglobals()["pytest"] = make()\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'certain'],
    ['`builtins.globals()`', 'import builtins\n\nimport pytest\n\nbuiltins.globals()["pytest"] = make()\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'certain'],
    ['`sys.modules`', 'import sys\n\nimport pytest\n\nsys.modules[__name__].pytest = make()\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'certain'],
    ['`__globals__`', 'import pytest\n\n\ndef test_t():\n    pytest.skip("x")\n\n\ntest_t.__globals__["pytest"] = make()\n', 'certain'],
    // uncertain: the rule is about the whole file — any other binding of the name, in any symbol table (even one
    // Python's scoping keeps away from the use), a second import, a builtin of the same name
    ['`from unittest import skipIf as print` (a builtin shadowed)', 'from unittest import skipIf as print\n\n\n@print(True, "x")\ndef test_t():\n    pass\n', 'uncertain'],
    ['`import pytest` twice, the same module', 'import pytest\nimport pytest\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['`import unittest` and `import unittest.mock`', 'import unittest\nimport unittest.mock\n\n\n@unittest.skip("x")\ndef test_t():\n    pass\n', 'uncertain'],
    ['a local of another function', 'import pytest\n\n\ndef helper():\n    pytest = 1\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['a parameter of another function', 'import pytest\n\n\ndef helper(pytest):\n    return pytest\n\n\ndef test_t():\n    pytest.skip("x")\n', 'uncertain'],
    ['`nonlocal` between two other functions', 'import pytest\n\n\ndef outer():\n    pytest = 1\n\n    def inner():\n        nonlocal pytest\n        pytest = 2\n\n\ndef test_t():\n    pytest.skip("x")\n', 'uncertain'],

    ['`del` of a local in another function', 'import pytest\n\n\ndef helper():\n    del pytest\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['a comprehension variable', 'import pytest\n\nnames = [pytest for pytest in "ab"]\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['a lambda parameter', 'import pytest\n\nident = lambda pytest: pytest\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['a class attribute, used in a method', 'import pytest\n\n\nclass TestA:\n    pytest = None\n\n    def test_t(self):\n        pytest.skip("x")\n', 'uncertain'],
    // uncertain: symtable classifies the name as anything but the module's global in another table, or it starts with `__`
    ['free in a method: `__classdict__` of a generic method (PEP 695; older Pythons do not compile it)', 'from pytest import skip as __classdict__\n\n\nclass TestA:\n    def test_t[T](self):\n        __classdict__("x")\n', 'uncertain'],
    ['free in a closure of another function', 'import pytest\n\n\ndef outer():\n    pytest = 1\n\n    def inner():\n        return pytest\n\n\ndef test_t():\n    pytest.skip("x")\n', 'uncertain'],
    ['an imported name that starts with `__` (a dunder)', 'from pytest import skip as __omit__\n\n\ndef test_t():\n    __omit__("x")\n', 'uncertain'],
    ['an imported name that starts with `__` (private, no class in the file)', 'from pytest import skip as __omit\n\n\ndef test_t():\n    __omit("x")\n', 'uncertain'],
    ['`__name__` rebound by the import (implicit in every module)', 'from pytest import skip as __name__\n\n\ndef test_t():\n    __name__("x")\n', 'uncertain'],
    // uncertain: the name is rebound somewhere in the module, before or after the use, in any scope
    ['assigned after a use in a test body', 'import pytest\n\n\ndef test_t():\n    pytest.skip("x")\n\n\npytest = make()\n', 'uncertain'],
    ['assigned before a use in a test body', 'import pytest\n\npytest = make()\n\n\ndef test_t():\n    pytest.skip("x")\n', 'uncertain'],
    ['a local of the test itself', 'import pytest\n\n\ndef test_t():\n    pytest = make()\n    pytest.skip("x")\n', 'uncertain'],
    ['a walrus', 'import pytest\n\nif (pytest := make()):\n    pass\n\n\ndef test_t():\n    pytest.skip("x")\n', 'uncertain'],
    ['an import inside the test', 'def test_t():\n    import pytest\n    pytest.skip("x")\n', 'uncertain'],
    ['a Unicode alias imported inside the test', 'def test_t():\n    from unittest import SkipTest as ' + String.fromCharCode(0x505c) + '\n    raise ' + String.fromCharCode(0x505c) + '("x")\n', 'uncertain'],
    ['a walrus in a comprehension (binds the module)', 'import pytest\n\nflags = [(pytest := n) for n in "ab"]\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['a match capture', 'import pytest\n\nmatch print:\n    case pytest:\n        pass\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['an annotated assignment', 'import pytest\n\npytest: object = make()\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['`pyteſt` assigned (NFKC: `pytest`)', 'import pytest\n\npyte' + String.fromCharCode(0x17f) + 't = make()\n\n\ndef test_t():\n    pytest.skip("x")\n', 'uncertain'],
    ['a class attribute, used by a method\'s decorator', 'import pytest\n\n\nclass TestA:\n    pytest = make()\n\n    @pytest.mark.skip\n    def test_t(self):\n        pass\n', 'uncertain'],
    ['a parameter of the test (a fixture)', 'import pytest\n\n\ndef test_t(pytest):\n    pytest.skip("x")\n', 'uncertain'],
    ['an alias rebound', 'from pytest import skip as now\n\n\ndef test_t():\n    now("x")\n\n\nnow = print\n', 'uncertain'],
    ['assigned', 'import pytest\n\npytest = make()\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['assigned through `global` in a function', 'import pytest\n\n\ndef helper():\n    global pytest\n    pytest = 1\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['imported through `global` in a function', 'import pytest\n\n\ndef helper():\n    global pytest\n    import os as pytest\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['deleted', 'import pytest\n\ndel pytest\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['a def of the same name', 'import pytest\n\n\ndef pytest():\n    pass\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['a for target', 'import pytest\n\nfor pytest in []:\n    pass\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['a with target', 'import pytest\n\nwith open("x") as pytest:\n    pass\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['an except target', 'import pytest\n\ntry:\n    pass\nexcept Exception as pytest:\n    pass\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['imported twice', 'import pytest\nimport os as pytest\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['a star import anywhere', 'import pytest\nfrom helpers import *\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    // uncertain, a courtesy outside the assumption: an evident direct write on the imported name
    ['`pytest.mark.skip = …`', 'import pytest\n\npytest.mark.skip = make()\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['`setattr(pytest, …)`', 'import pytest\n\nsetattr(pytest, "skip", make())\n\n\ndef test_t():\n    pytest.skip("x")\n', 'uncertain'],
    ['`pytest.__setattr__(…)`', 'import pytest\n\npytest.__setattr__("skip", make())\n\n\ndef test_t():\n    pytest.skip("x")\n', 'uncertain'],
    ['`del pytest.mark`', 'import pytest\n\ndel pytest.mark\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    // uncertain: a one-step alias of the vocabulary, read as what it aliases (never silence)
    ['`omit = pytest.mark.skip`', 'import pytest\n\nomit = pytest.mark.skip\n\n\n@omit\ndef test_t():\n    pass\n', 'uncertain'],
    ['`m = pytest.mark`', 'import pytest\n\nm = pytest.mark\n\n\n@m.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['`skip_win = pytest.mark.skipif(…)`', 'import sys\n\nimport pytest\n\nskip_win = pytest.mark.skipif(sys.platform == "win32", reason="x")\n\n\n@skip_win\ndef test_t():\n    pass\n', 'uncertain'],
    ['`now = pytest.skip` in a function', 'import pytest\n\n\ndef test_t():\n    now = pytest.skip\n    now("x")\n', 'uncertain'],
    ['an import inside `try`', 'try:\n    import pytest\nexcept ImportError:\n    pytest = None\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    // uncertain: not an import of pytest or unittest
    ['a local `skip`', 'def skip(reason):\n    return lambda f: f\n\n\n@skip("x")\ndef test_t():\n    pass\n', 'uncertain'],
    ['an import of another module', 'from helpers import skip\n\n\n@skip("x")\ndef test_t():\n    pass\n', 'uncertain'],
    ['`mark` with no import', '@mark.skip\ndef test_t():\n    pass\n', 'uncertain'],
    ['another module under the name `unittest`', 'import os as unittest\n\n\n@unittest.skip("x")\ndef test_t():\n    pass\n', 'uncertain'],
  ] as const)('%s', async (_why, source, want) => {
    expect(await py(source)).toBe(want);
  });

  it('`pytest.xfail()` in the body follows the same rule', async () => {
    expect(await py('import pytest\n\n\ndef test_t():\n    pytest.xfail("x")\n', 'xfail')).toBe('certain');
    expect(await py('import pytest\n\n\ndef test_t():\n    pytest.xfail("x")\n\n\ndel pytest\n', 'xfail')).toBe('uncertain');
  });

  const testCase = (classes: string, imports = 'import unittest\n'): string => `${imports}\n\n${classes}`;
  const target = '\nclass TestA(Base):\n    def test_t(self):\n        self.skipTest("x")\n';
  it.each([
    ['unittest.TestCase directly (case B)', testCase('class TestA(unittest.TestCase):\n    def test_t(self):\n        self.skipTest("x")\n'), 'certain'],
    ['`from unittest import TestCase`', testCase('class TestA(TestCase):\n    def test_t(self):\n        self.skipTest("x")\n', 'from unittest import TestCase\n'), 'certain'],
    ['a base in the file', testCase(`class Base(unittest.TestCase):\n    pass\n\n${target}`), 'certain'],
    ['a mixin from `object` and a TestCase base', testCase(`class Mixin(object):\n    pass\n\n\nclass Base(Mixin, unittest.TestCase):\n    pass\n\n${target}`), 'certain'],
    ['an override in the class', testCase('class TestA(unittest.TestCase):\n    def skipTest(self, reason):\n        pass\n\n    def test_t(self):\n        self.skipTest("x")\n'), 'uncertain'],
    ['an override in a base', testCase(`class Base(unittest.TestCase):\n    def skipTest(self, reason):\n        pass\n\n${target}`), 'uncertain'],
    ['an override assigned in a base', testCase(`class Base(unittest.TestCase):\n    skipTest = print\n\n${target}`), 'uncertain'],
    ['an override assigned after the class', testCase(`class Base(unittest.TestCase):\n    pass\n\n\nBase.skipTest = print\n\n${target}`), 'uncertain'],
    ['`__getattribute__` in a base', testCase(`class Base(unittest.TestCase):\n    def __getattribute__(self, name):\n        return object.__getattribute__(self, name)\n\n${target}`), 'uncertain'],
    ['a diamond with an override', testCase(`class Base(unittest.TestCase):\n    pass\n\n\nclass Quiet(Base):\n    def skipTest(self, reason):\n        pass\n\n\nclass Plain(Base):\n    pass\n\n\nclass TestA(Plain, Quiet):\n    def test_t(self):\n        self.skipTest("x")\n`), 'uncertain'],
    ['a base imported from another module', testCase(target, 'from support import Base\n'), 'uncertain'],
    ['a decorated base', testCase(`@decorate\nclass Base(unittest.TestCase):\n    pass\n\n${target}`), 'uncertain'],
    ['a metaclass', testCase('class TestA(unittest.TestCase, metaclass=Meta):\n    def test_t(self):\n        self.skipTest("x")\n'), 'uncertain'],
    ['no TestCase at all (a pytest class)', testCase('class TestA:\n    def test_t(self):\n        self.skipTest("x")\n'), 'uncertain'],
    ['a decorated method', testCase('class TestA(unittest.TestCase):\n    @decorate\n    def test_t(self):\n        self.skipTest("x")\n'), 'uncertain'],
    ['`self` rebound in the method', testCase('class TestA(unittest.TestCase):\n    def test_t(self):\n        self = other\n        self.skipTest("x")\n'), 'uncertain'],
    ['`unittest` rebound after the class', testCase('class TestA(unittest.TestCase):\n    def test_t(self):\n        self.skipTest("x")\n\n\nunittest = None\n'), 'uncertain'],
    ['`unittest` rebound before the class', testCase('unittest = make()\n\n\nclass TestA(unittest.TestCase):\n    def test_t(self):\n        self.skipTest("x")\n'), 'uncertain'],
    ['`TestCase` rebound', testCase('class TestA(TestCase):\n    def test_t(self):\n        self.skipTest("x")\n\n\nTestCase = object\n', 'from unittest import TestCase\n'), 'uncertain'],
    ['`import … as skipTest` in the class body', testCase('class TestA(unittest.TestCase):\n    from builtins import print as skipTest\n\n    def test_t(self):\n        self.skipTest("x")\n'), 'uncertain'],
    ['`def skipTest` inside `if True:` of the class body', testCase('class TestA(unittest.TestCase):\n    if True:\n        def skipTest(self, reason):\n            pass\n\n    def test_t(self):\n        self.skipTest("x")\n'), 'uncertain'],
    ['`case skipTest:` in the class body', testCase('class TestA(unittest.TestCase):\n    match print:\n        case skipTest:\n            pass\n\n    def test_t(self):\n        self.skipTest("x")\n'), 'uncertain'],
    ['a `for skipTest in …` in a base\'s body', testCase(`class Base(unittest.TestCase):\n    for skipTest in [print]:\n        pass\n\n${target}`), 'uncertain'],
    ['`skipTest` bound in another class (not in the chain: the file binds it)', testCase(`class Base(unittest.TestCase):\n    pass\n\n\nclass Other:\n    def skipTest(self):\n        pass\n\n${target}`), 'uncertain'],
    ['`setattr(Base, "skipTest", …)` (courtesy)', testCase(`class Base(unittest.TestCase):\n    pass\n\n\nsetattr(Base, "skipTest", print)\n\n${target}`), 'uncertain'],
    ['`unittest.TestCase.skipTest = …` (courtesy)', testCase('class TestA(unittest.TestCase):\n    def test_t(self):\n        self.skipTest("x")\n\n\nunittest.TestCase.skipTest = print\n'), 'uncertain'],
  ] as const)('self.skipTest: %s', async (_why, source, want) => {
    expect(await py(source)).toBe(want);
  });

  it('assertions: the assert statement, pytest.raises and self.assertX through TestCase are certain; mocks are not', async () => {
    const f = await parseTestFile(
      'test_a.py',
      'import unittest\n\nimport pytest\n\n\ndef test_t():\n    assert 1 == 1\n    with pytest.raises(ValueError):\n        int("x")\n    m.assert_called_with(1)\n\n\nclass TestA(unittest.TestCase):\n    def test_u(self):\n        self.assertEqual(1, 1)\n',
    );
    expect(f.tests.map((t) => [t.name, t.assertionSites.map((a) => a.binding.certain)])).toEqual([
      ['test_t', [true, true, false]],
      ['TestA::test_u', [true]],
    ]);
    // A file that binds `assertEqual` anywhere (here an override in another class): no `self.assertEqual` in it is certain.
    const overridden = await parseTestFile(
      'test_a.py',
      'import unittest\n\n\nclass TestA(unittest.TestCase):\n    def test_u(self):\n        self.assertEqual(1, 1)\n\n\nclass TestB(unittest.TestCase):\n    def assertEqual(self, a, b):\n        pass\n\n    def test_v(self):\n        self.assertEqual(1, 2)\n',
    );
    expect(overridden.tests.map((t) => [t.name, t.assertionSites.map((a) => a.binding.certain)])).toEqual([
      ['TestA::test_u', [false]],
      ['TestB::test_v', [false]],
    ]);
    const rebound = await parseTestFile('test_a.py', 'import pytest\n\n\ndef test_t():\n    with pytest.raises(ValueError):\n        int("x")\n\n\npytest = make()\n');
    expect(rebound.tests[0]!.assertionSites.map((a) => a.binding.certain)).toEqual([false]);
  });
});
