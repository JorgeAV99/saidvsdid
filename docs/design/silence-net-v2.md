# The silence net, v2: a term table (design proposal)

> **Status: design proposal, not implemented; its priority is set by the benchmark.**
> Written in round 11 of pull request #4 as the closed definition of every term of the
> silence guarantee, it was withdrawn before any code was written. The contract
> that blocks a merge is now much smaller (docs/rules.md, *The silence
> guarantee*): agents that weaken tests use direct forms, and widening and
> grouping more adds noise with no evidence that it is needed. What this table
> would add — numeric keys, name sets that match when they intersect, the
> approximations below — is a best-effort improvement, to be prioritised with
> data from real pull requests (docs/backlog.md).
>
> Nothing here describes what saidvsdid does today; docs/rules.md does
> (*Best-effort detection*).

## Why it was written

Codex's review of the commit that split the guarantee matrix into a suite slice and a CI job (round 11, P1) found a silence inside the round-10
guarantee: numeric literal keys were not member steps, so

```js
const box = {}; const alias = box; alias[0] = ctx.skip;
// head adds, in a test:
box[0]();
```

was silent (and `alias[0]` → `box['0']()`, `alias['0']` → `box[0]()`), as was
the Python `box = {}; alias = box; alias[0] = self.skipTest` then
`box[0]("later")`. The answer proposed was to give every term of the
guaranteed list a closed, enumerated meaning before implementing anything.
Table v1 (in the conversation, not versioned) went to a design review by
Codex, reproduced below; v2 is the answer to it.

## The principle

- The silence guarantee is a **conservative syntactic over-approximation for `WARN`**, not a semantic identity. Each key or name the code writes is translated into a **set of possible names** (its *name set*); two accesses are the same member for the net when their sets **intersect**.
- Some groupings are deliberate and documented as approximations (*Documented approximations*, below): Python's attribute and subscript, Python's numeric types, `?.` and its short-circuit, the explicit receiver of `Reflect.get`, the default of `getattr`, `#k` and `'#k'`. Grouping too much only adds `WARN`s.
- None of this touches `FAIL`: the resolution that decides a `FAIL` — `py-binding` (python/saidvsdid_scopes.py, `ast` and `symtable`) and `ts-binding` (src/parse/ts-program.ts, the TypeScript checker) — reads each name by the language's rules of lexical scope and uses no name set, no grouping and no approximation of this table (*FAIL roots*, below).
- Checked against the languages by a differential test: whenever the real language says two literal keys are the same key — Node `o[A] = 1; o[B]`, Python `d = {A: 1}; B in d` — their name sets intersect; the converse is not required (that is the approximation). Python's mangling is checked against `compile()` and the code object's `co_names`.

## The terms

Each term has a closed meaning per language: what is in, and what is coverage, with the reason.

- **name** — an identifier or a member's name as the language reads it; its name set is that one name.
  - JS/TS, in: an identifier or a dotted member name, escapes decoded (`it.\u0073kip` is `skip`); a private name `#k`, whose name set is `'#k'` (grouped with the string, whatever class declares it)
  - Python, in: an identifier or an attribute name, NFKC-normalised as `ast` gives it (`ｓkip` is `skip`); mangled per the language reference, inside a class at any depth: `__x` becomes `_C__x` with `C` the nearest enclosing class's name without its leading `_`; no mangling when the name ends in `__` or the class name is only `_`; literal strings are never mangled (`getattr(self, "__x")` is `__x`)
- **literal key** — an expression whose value as a key is fixed by its spelling alone, read after the one normalisation (src/parse/normalise.ts: parentheses and TS assertions removed); the reader keeps its exact type and value, and its name set is computed from them.
  - JS/TS, in: a string literal, escapes decoded (`'skip'`, `"\x73kip"`, `'\u{73}kip'`); a template without substitution (`` `skip` ``, its cooked value); a Number literal — decimal, `0x`, `0o`, `0b`, separators, exponent — and a BigInt literal (`1n`, `0x10n`), distinguished as literal types; a single unary `-` on a Number or a BigInt literal (`-1`, `-0`, `-1n`); a single unary `+` on a Number literal (`+0`); `true`, `false`, `null`; name set: the one string `ToPropertyKey` gives — `0x10`, `16`, `16n`, `16.0`, `'16'` are `'16'`; `-0` is `'0'`; `-1n` is `'-1'`; `1e21` is `'1e+21'`; `1e309` is `'Infinity'`; `true` is `'true'`
  - JS/TS, coverage: `+1n` (a `TypeError` at run time, no key); legacy numeric literals (`010`, `08`, `09`) and legacy escapes (`\8`, `\9`, octal escapes) (legacy syntax, an error in strict code); `undefined`, `NaN`, `Infinity` (identifiers, not literals: they may be shadowed); nested signs (`- -1`), `~`, `!`, `void`, any other operator, a template with a substitution (an expression, not a literal); a symbol (`Symbol.iterator`), a regular expression, an array or object literal as a key (not a literal key of the table)
  - Python, in: a `Constant`: `str`, `bytes`, `int`, `bool`, `float`, `complex` (`1j`), `None`, `...`; adjacent literals are the one `Constant` the parser makes (`"sk" "ip"`); `\N{…}` with the value Python decodes, literal in a raw string; an f-string without a replacement field (`f"skip"`, a `JoinedStr` of `Constant`s only), its value the concatenation; a single unary `-` or `+` on a numeric `Constant`, `bool` included (`-1`, `+1.5`, `-1j`, `-True` is `-1`); name set: a `str` key shares the name of the attribute it spells (`R["k"]` and `R.k`: grouped); a numeric key is its class of equal values (`0`, `False`, `0.0`, `-0.0`, `0j` one class; `1`, `True`, `1.0` another), a possible match, never an identity; `bytes`, `None` and `...` each their own key, never a name; the canonical key is computed by Python itself from the value
  - Python, coverage: nested signs (`- -1`), `~`, `not`, a `BinOp` (`1+0j`, `"sk" + "ip"`) (an expression, not a `Constant`); a tuple, a slice, several subscripts (`R[0, 1]`, `R[0:1]`) (compound, not atomic); an f-string with a replacement field (built at run time)
- **member step** — one member access with a name set: a dot, a literal subscript, or a by-name primitive that returns the member. All its spellings are one step (src/parse/normalise.ts, `memberStep`), in a read, in a target and at every step of a chain.
  - JS/TS, in: `R.k`, `R?.k`, `R.#k`, `R[L]`, `R?.[L]` with `L` a literal key; `Reflect.get(R, L[, receiver])` with `L` a literal key, the callee written `Reflect.get`, `Reflect['get']`, `Reflect?.get` or `Reflect?.['get']`, recognised by its spelling
  - JS/TS, coverage: `super.k`, `super[L]` (the receiver is the class's prototype chain, not a binding); an alias of a primitive (`const g = Reflect.get`) (a primitive is recognised by its spelling only); `Reflect.set`, `Object.defineProperty`, `Object.assign` (a member written through a call (`call-writes`))
  - Python, in: `R.k`; `R[L]` with `L` one literal key; `getattr(R, S[, default])` with `S` a `str` literal, the callee written `getattr` or `builtins.getattr`, recognised by its spelling
  - Python, coverage: `getattr` with a literal that is not a `str` (`getattr(R, 0)`) (a `TypeError` at run time, no member); `super().k` (a call's result); an alias of a primitive (`ga = getattr`) (a primitive is recognised by its spelling only); `setattr`, `object.__setattr__`, `vars(R)[…]` (a member written through a call (`call-writes`))
- **receiver** — what a member target or a read member hangs from: a root followed by zero or more member steps (a chain, of any length). Parentheses and TS assertions are transparent; a call is excluded, except a by-name primitive admitted as a step.
  - JS/TS, in: a root: an identifier, or `this`; followed by member steps of any spelling (`a.b['c']`, `Reflect.get(this.a, 'b').c`, `(box as any)[0]`, `box!.k`)
  - JS/TS, coverage: a call (`f().k`, `getBox()[0]`), `new X().k`, `super` (a function's result); a subscript that is not a literal key (`a[k].b`, `a[i + 1]`) (computed at run time)
  - Python, in: a root: an identifier (`self`, `cls` or any other: no spelling is special); followed by member steps of any spelling (`a.b["c"]`, `getattr(self.a, "b").c`, `box[0]`)
  - Python, coverage: a call (`f().k`, `super().k`) (a function's result); a subscript that is not a literal key (`a[k].b`) (computed at run time)
- **use** — a site that may run the callee; the callee — the expression before the final argument list, the decorator's expression, the raised expression — is read like a value (below), its subscripts and keys included. Parentheses are removed where transparent: `r?.k()` and `(r?.k)()` are both a use, grouped.
  - JS/TS, in: a call `E(…)`, an optional call `E?.(…)` and a call through `?.` (`r?.k()`); a tagged template (`` E`…` ``), a call of a call (`E(…)(…)`), `E.call(…)`, `E.apply(…)`, `E.bind(…)(…)`
  - JS/TS, coverage: `new E(…)`, `super(…)`, `super.k(…)`, `import(…)` (not a call of a value the net binds); a call made by the language (a getter, `toString`, `valueOf`, an iterator), `eval` or `Function` of a string (no call site in the code); a decorator (JS decorators are excluded from the guarantee)
  - Python, in: a call `E(…)`; a decorator `@E` or `@E(…)`, any decorator expression (PEP 614); `raise E`, `raise E(…)`, `raise E from C` (the exception, not the cause)
  - Python, coverage: a call made by the language (an operator's dunder, a descriptor, `__enter__`, a metaclass), `exec` or `eval` of a string (no call site in the code)
- **value** — what a binding binds, and a callee: it holds a token, a marked name or a string of the vocabulary if one appears anywhere in it, except in what is cut. Every identifier counts as a whole (a token or a marked name, never a substring), every member's name of a step (a dot, `#k`, a literal key, a by-name primitive's literal name), every string of the vocabulary used as data — in containers, conditionals, operators, `await`, spreads.
  - JS/TS, in: a call keeps its callee and cuts its arguments (`ctx.skip.bind(ctx)` holds `skip`; `r = f(GOOD)` holds nothing), except a by-name primitive, whose literal name is read (`Reflect.get(box, 'skip')`, `Reflect.has(it, 'skip')`); `.bind(…)` counts as a call of `bind` and as an alias's origin; a function value (an arrow, a function expression): its body's tokens, names and literal member names count (`() => ctx["skip"]()` marks); a string used as data is cut on entering it
  - JS/TS, coverage: a propagation that needs a function's result (`const s = make()` where `make` returns `ctx.skip` through a `function` declaration), a value passed into a function (`run(omit)`) (values that enter or leave a function); class fields and members, enums, TypeScript types (`kind?: 'skip'`) (excluded subtrees: they prevail over "anywhere", even where the net visits them best effort)
  - Python, in: a call keeps its callee and cuts its arguments (`pytest.mark.skip(reason="x")` holds `skip`; `r = f(GOOD)` holds nothing), except a by-name primitive (`getattr`, `hasattr`, `setattr`, `delattr`), whose literal name is read; a `lambda`: its body's tokens, names and literal member names count; a string used as data is cut on entering it (`key = lambda: "skip"` holds no string)
  - Python, coverage: a propagation that needs a function's result (`s = make()` where `make` is a `def`), a value passed into a function (values that enter or leave a function); class bodies' members, enums (excluded subtrees: they prevail over "anywhere", even where the net visits them best effort)
- **string of the vocabulary** — a literal key whose value is a token (src/parse/vocabulary.ts), or a string literal whose value the reader cannot decode for certain (read as possibly every token, best effort); a name holds one when its value does, outside the functions it defines.
  - JS/TS, in: a string literal or a template without substitution equal to a token
  - JS/TS, coverage: a number, a BigInt, `true`/`false`/`null` (no token is one)
  - Python, in: a `str` literal (a `Constant`, an f-string without a replacement field) equal to a token
  - Python, coverage: `bytes` (never a name)
- **binding** — what makes a name an alias: it binds every name of its target — a member target every name of its receiver chain — when its value holds a token, a marked name or a string of the vocabulary, to a fixed point in the file.
  - JS/TS, in: a declaration (`const`, `let`, `var`, `export const`), an assignment with any operator (`=`, `+=`, `||=`, `??=`, `&&=`…); a parameter default; an import under another name; a member target: a dot or a literal subscript on a receiver (`box[0] = V`, `this.a['b'] = V`); a destructuring, recursive: array and object patterns, nested, rest, defaults; an object pattern's key is a literal key or a name that holds a string of the vocabulary; its targets may be member targets (`({ k: box.omit = V } = {})`); the test context's first parameter destructured
  - JS/TS, coverage: `for … of`/`for … in` bindings, `catch (e)` (an iteration or an exception binds them); `function` and `class` declarations, `using`/`await using` (a declaration of a function or a class, a disposal); an object pattern's computed key that is neither a literal key nor a name holding a string (computed at run time)
  - Python, in: an assignment (`=`, several targets `a = b = V`), an annotated assignment, an augmented assignment (every operator), a walrus; a parameter default; an import under another name; a member target: an attribute or a literal subscript on a receiver (`box[0] = V`, `self.a["b"] = V`); an unpacking, recursive: tuple and list targets, nested, starred (`(a, *rest) = V`, `[a, (b, c)] = V`); its targets may be member targets
  - Python, coverage: `for` targets, comprehensions, `with … as`, `except … as`, `match` patterns (an iteration, a context manager, an exception or a pattern binds them); `def`, `class`, `global`/`nonlocal` alone, `del` (a declaration of a function or a class, or no value)
- **test context** — a root by its role, never by its spelling.
  - JS/TS, in: the first parameter of a test's or an inline hook's callback, whatever its name (`(ctx) => …`, `function (t) {…}`), destructured too (`({ skip: omit }) => omit()`)
  - JS/TS, coverage: Playwright's `testInfo` (the second parameter) and fixtures (not the first parameter; their members are still tokens)
  - Python, in: the first parameter of a method of a `unittest.TestCase` subclass (a class whose bases reach `unittest.TestCase` or `IsolatedAsyncioTestCase` in the file), whatever its name and decorators
  - Python, coverage: a class whose base comes from another module (its bases are not read across files)

**Documented approximations** — groupings made on purpose; they only add `WARN`s, and no `FAIL` reads them:

- Python: an attribute and a `str` subscript are one name (`R.k`, `R["k"]`, `getattr(R, "k")`), though `__getattr__` and `__getitem__` are different protocols
- Python: equal numbers are one class of keys (`0`, `False`, `0.0`, `-0.0`, `0j`), a possible match; the reader keeps the type and the value
- JS: `R?.k` is `R.k`, its short-circuit ignored; `r?.k()` and `(r?.k)()` are one use
- JS: the explicit receiver of `Reflect.get(R, k, receiver)` is ignored (a getter may read it)
- Python: `getattr(R, "k", default)` is `R.k`, the default ignored
- JS: `#k` is the string `'#k'`, whatever class declares it
- a by-name primitive is recognised by its spelling (`getattr`, `builtins.getattr`, `Reflect.get`, `Reflect?.get`, `Reflect['get']`), its shadowing not resolved: a local `getattr` only adds noise
- names spread by their spelling (Python's mangled), whatever the scope or declaration
- a binding binds every name of its target: positions in a pattern are not tracked, and a member target binds its whole receiver chain (`self.omit = …` binds `self` and `omit`)
- Python: a method's first parameter is the context whatever the method's decorators (`@staticmethod` too)

**Roots of a `WARN`** (the net, and the extractor's "may"):

- JS/TS: every import of a runner module (`vitest`, `@jest/globals`, `@playwright/test`, `node:test`) — named or renamed, default, namespace, `import x = require('m')`, `require('m')` — except a type-only one (`import type`, `import { type it }`: nothing at run time)
- JS/TS: a runner global used without an import (Jest's, Vitest's, Mocha's): always `WARN` "may be skipped", never `FAIL`
- Python: every import of `pytest` or `unittest` or one of their submodules, wherever it is (`import pytest as pt`, `from unittest import TestCase`, an import inside a function or a `try`)
- the test context, by its role (*test context*, above)
- coverage: a dynamic import (`import('vitest')`), `__import__`, `importlib.import_module`

**Roots of a `FAIL`** — unchanged, separate, read by the languages' own tooling:

- JS/TS (`ts-binding`, src/parse/ts-program.ts): at each occurrence, the compiler's local symbol, never followed through the import, with exactly one declaration — an import specifier, a namespace import or a default clause of a static `import … from`, not type-only, of `vitest`, `@jest/globals`, `@playwright/test` or `node:test` — in a form that runner's API has. `require`, `import x = require`, a dynamic import, a merged declaration: `WARN`
- Python (`py-binding`, python/saidvsdid_scopes.py): a name whose one binding in the file (`ast`) is an import of `pytest` or `unittest` that is a statement of the module; `symtable` says in every other table that it is absent or global and nothing else; it does not start with `__`, is not a builtin, and the file has no star import
- Python: `self.skipTest` only through a certain `unittest.TestCase` chain of the module, in an undecorated method whose `self` is bound nowhere else, in a file that binds `skipTest` nowhere (case B)

**Closure rule.**

- Recursive combinations of admitted forms are in: a chain of steps of any admitted spelling, a pattern nested in a pattern, a value that nests admitted forms, an alias of an alias.
- Exclusions take explicit precedence over "contains anywhere": a token inside an excluded subtree (a class field, an enum, a type) does not make it in.
- Any other syntactic production is coverage: read best effort, never guaranteed. The examples of coverage are not a list that closes it.

## Additions of this proposal beyond the decisions of the review

The decisions taken on Codex's v1 review are listed in the next section; v2
also proposes, for review:

- in: an f-string without a replacement field (`f"skip"`, a `JoinedStr` of
  `Constant`s only) and, in JS, a template without substitution — the reader
  accepts both today;
- in: adjacent string literals (`"sk" "ip"`), one `Constant` for the parser;
- in: identifiers as the language reads them — JS escapes decoded
  (`it.\u0073kip`), Python NFKC-normalised;
- uses: a tagged template, `E.call`, `E.apply`, `raise E from C` (the
  exception, not the cause);
- coverage: `undefined`, `NaN`, `Infinity` in JS (identifiers that may be
  shadowed); nested signs in JS; Playwright's `testInfo`; a dynamic `import()`,
  `__import__`, `importlib`;
- WARN roots: submodules of pytest/unittest, and imports inside a function or
  a `try`;
- approximation: in Python, a method's first parameter is the context whatever
  its decorators (`@staticmethod` too).

## The decisions taken on the v1 review

1. Python `R.k` / `R['k']`: grouped, a documented approximation.
2. Python numbers: the reader keeps the exact type and value; numeric
   unification (`1`, `True`, `1.0`…) is a possible-match relation for `WARN`,
   not an identity.
3. JS: `Number` and `BigInt` distinguished as literal types; `-1n` in (`'-1'`);
   `+1n` coverage (`TypeError`, no key); every legacy numeric literal (`010`,
   `08`, `09`) and legacy escape (`\8`, `\9`, octal) coverage; `1e309` in,
   canonical `'Infinity'`.
4. Python grammar: a `Constant` (`1j` and `bool` included), or one unary
   `-`/`+` on a numeric `Constant` (`bool` included: `-True` is `-1`); nested
   signs and a `BinOp` (`1+0j`) are coverage.
5. Identifiers: JS `#k` grouped by its spelling `'#k'`, whatever class declares
   it; Python mangling per the language reference (the class name's leading
   `_` stripped, none when the class is only `_` or the name ends in `__`),
   with a differential test against `compile()` and the code object's
   `co_names`.
6. `\N{…}` in, with the value Python decodes; literal in a raw string; a
   file the interpreter does not compile is a file-level `WARN`.
7. Parentheses removed only where transparent; `r?.k()` and `(r?.k)()` are both
   a use, grouped.
8. Codex's proposals adopted as they are: in receivers, calls excluded except
   the primitives admitted as steps; reading a value keeps the callee and cuts
   its arguments, except in transparent primitives; coverage is a propagation
   that needs a function's result, not any expression holding a call; `.bind(…)`
   is a call of `bind` and a possible alias origin — so
   `omit = pytest.mark.skip(reason="x")` and `ctx.skip.bind(ctx)` mark.
9. A literal used as a member's name counts where the identifier would
   (`() => ctx["skip"]()` marks); a string used as data is cut on entering a
   function; subtree exclusions (class fields, enums) prevail for the
   guarantee, even where best-effort analysis visits them.
10. Scope: destructuring patterns recursive (array/tuple, nested, rest/starred,
    defaults), literal keys only restrict keyed steps, `({k: box.omit = V} = {})`
    in; iteration bindings, comprehensions, `with … as`, `catch`/`except` and
    `match` explicit coverage; `function`/`def`, classes and `using` explicit
    coverage; primitives recognised by their spelling (also `builtins.getattr`
    and `Reflect?.get`), shadowing not resolved, an alias of a primitive
    coverage; WARN roots every import form of a runner module except a
    type-only one; FAIL roots unchanged and listed apart; the context defined
    by its role.

The v1 differential test of canonicalisations stays, as an over-approximation
test: when the real language says two forms are the same key, the sets must
intersect; the converse is allowed.

## Codex's design review of table v1

Verified with Node 24.19.0 and Python 3.12.10 (translated from the review on
the pull request). The table is not closed yet. The main problem is telling a
semantic identity from a conservative grouping for a `WARN`: several proposed
equivalences serve the second, but are not identities of the language.

1. **`R.k ≡ R['k']` is false in Python.** With
   `class R: k = "attribute"; def __getitem__(self, key): return "item"`,
   `r.k` and `getattr(r, "k")` give `"attribute"` while `r["k"]` gives
   `"item"`. Proposal: both forms in, with distinct canonicals,
   `attribute(name)` and `subscript(key)`; the net may group them for a
   `WARN`, documented as an approximation.
2. **Dictionary equality does not describe every subscript.**
   `len({1: "a", True: "b", 1.0: "c", 1+0j: "d"})` is 1, but `["a","b"][True]`
   is `"b"` and `["a","b"][1.0]` a `TypeError`; a `__getitem__` can tell the four
   types apart. Proposal: keep the exact type and value; numeric unification as
   a conservative possible-match relation for `WARN`.
3. **"Numeric" leaves JS cases unclassified.** `-1n` is the key `"-1"`: it must
   be in explicitly. `+1n` is a `TypeError`. `08` and `09` work in sloppy code
   and are an error in strict code: coverage, with every legacy numeric
   literal. `"\8"` and `"\9"`: coverage as legacy escapes. `Number` and
   `BigInt` must be told apart. `1e309` is in, canonical `"Infinity"`.
4. **The Python grammar must be concrete.** `1j` is a `Constant`; `-1j` is
   `UnaryOp(Constant)`; `1+0j` is a `BinOp`, not a `Constant`; `-True` is
   `UnaryOp(Constant)` with value -1; `-(-1)` is two `UnaryOp`s. Proposal:
   numeric constants in, imaginaries included, and one unary sign on them;
   `-True` in if "numeric" includes `bool`; `1+0j` and nested signs coverage.
5. **Identifiers.** JS: `#k` and `["#k"]` are different properties, and `A.#k`
   and `B.#k` are different private names even when `B` extends `A`. Python:
   `class ___C: __x` gives `_C__x`; `__x__` is not transformed; `class _: __x`
   neither. Proposal: specify how the class name is normalised (its leading
   `_` stripped), the exception of classes made only of `_` and of names ending
   in `__`; preferably, take it from the compiler.
6. **Excluding `\N{…}` has no principle.** `"\N{LATIN SMALL LETTER S}kip"` is
   `"skip"`; a raw string keeps the text. Proposal: in, with the string the
   interpreter produces; a file it does not compile is a file-level `WARN`.
7. **Removing wrappers must not erase semantics.** With `r = null`, `r?.k()` is
   `undefined` but `(r?.k)()` a `TypeError`. `Reflect.get(r, "k", {v: 2})` with
   a getter returns 2 while `r.k` is 1. `getattr(r, "missing", d)` returns `d`
   while `r.missing` raises. Proposal: they are in, may share a conservative
   `WARN` mark, and parentheses are removed only where transparent.
8. **Contradictions between step, receiver, use and value.**
   `getattr(box, "a").omit` is in as a step but goes through a call, excluded
   in a receiver. `omit = pytest.mark.skip(reason="x")` has a token in its
   callee, but is a function's result, which is coverage. `ctx.skip.bind(ctx)`
   has the same tension; `bind` makes a function without calling the original.
   Proposal: in receivers, exclude calls except the primitives admitted as
   steps; reading values, keep the callee and cut the arguments except in
   transparent primitives; coverage is a propagation that needs a function's
   result; `.bind` counts as a call of `bind` and as a possible alias origin.
9. **Strings inside functions.** `const omit = () => ctx["skip"]()`: tell the
   literal used as a member's name (it counts as the identifier) from the
   string used as data (cut on entering a function).
   `const C = class { static omit = ctx.skip; }`: "contains anywhere" clashes
   with "class fields: coverage". Proposal: subtree exclusions prevail for the
   guarantee.
10. **Scope decisions that are missing.** Destructuring: `[omit] = [V]`,
    `(omit,) = (V,)`, nested, rest/starred and defaults → recursive patterns;
    `({k: box.omit = V} = {})` → in; `for…of`, `for`, comprehensions,
    `with…as`, `catch`/`except` and `match` → explicit coverage if not
    guaranteed; `function`/`def`, classes and `using` → classify them;
    `builtins.getattr`, an alias `ga` and an optional `Reflect` → define them;
    roots: default, namespace, type-only and `import =` imports, without an
    alias; a parameter `me` instead of `self` → list which mark a `WARN` and
    which attribute a `FAIL`, and define the context by its role; say whether
    `getattr`/`Reflect` are recognised by spelling or by binding, as they may
    be shadowed.

Codex's closing rule: recursive combinations of admitted forms are in,
exclusions take explicit precedence, and any other syntactic production is
coverage.
