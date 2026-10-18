// The silence guarantee, and what the nets read beyond it.
//
// The guarantee (docs/rules.md, *The silence guarantee*, rendered from here by `renderGuarantee`): no false FAIL, and
// no silence for the direct forms — a member of the vocabulary used directly from its root (a runner import or the
// test context) and a simple alias of it in the same file. `contractCases` enumerates them, runner by runner, from
// the runners' API (src/parse/ts-binding.ts, RUNNER_API) and the vocabulary (src/parse/vocabulary.ts); each has a
// fixture with the real runner's evidence (test/contract-fixtures.test.ts).
//
// Everything else the contagion net (src/rules/contagion.ts) reads is best effort, with no guarantee (docs/rules.md,
// *Best-effort detection*, rendered by `renderBestEffort`): the lists below say what it reads today, and the
// cartesian matrix built from them (test/guarantee-matrix.ts; its slice in test/silence-guarantee.test.ts, the whole
// of it in the CI job `guarantee matrix (full)`) protects that against regressions. Widening it is backlog, to be
// prioritised with data (docs/backlog.md; a proposal: docs/design/silence-net-v2.md).
import type { MarkerKind } from '../parse/types.js';
import { RUNNER_API, type RunnerPackage } from '../parse/ts-binding.js';
import { JS_TOKENS, PY_MARK_KINDS, PY_PYTEST_CALL_KINDS, PY_TESTCASE_METHODS, PY_TOKENS, PY_UNITTEST_DECORATORS, PY_UNITTEST_EXCEPTIONS } from '../parse/vocabulary.js';

export interface GuaranteeEntry {
  /** A stable id, the key of the test's templates. */
  id: string;
  /** What the form is, as docs/rules.md says it. */
  text: string;
}

/** The uses: one reading of what is called, applied or raised (src/rules/contagion.ts, `contagionUses`). */
export const BEST_EFFORT_USES: readonly GuaranteeEntry[] = [
  { id: 'call', text: 'a call (`omit(…)`)' },
  { id: 'decorator', text: 'a decorator (`@omit`, `@omit(…)`; Python)' },
  { id: 'raise', text: 'a raise (`raise omit`, `raise omit(…)`; Python, the `SkipTest` member)' },
];

/**
 * A by-name access primitive. `reads`: it returns the member's value, so it is a member step like a dot or a
 * literal subscript (src/parse/normalise.ts, `memberStep`): `getattr(R, 'k')` is `R.k`, part of a receiver chain
 * and of a callee that is called or raised. The others test or write the member (`hasattr`, `setattr`, `delattr`,
 * `Reflect.has`): they are transparent — their literal name is read as a string of the vocabulary — but return no
 * member, so they are never a step of a chain. `args`: the positional arguments it takes (a default for `getattr`,
 * a receiver for `Reflect.get`).
 */
export interface ByNamePrimitive {
  name: string;
  reads: boolean;
  args: readonly [number, number];
}

/**
 * The by-name access primitives, with a literal name: one list. src/parse/normalise.ts reads the ones that return the
 * value as a member step, src/rules/contagion.ts keeps all of them transparent, docs/rules.md renders them, the matrix
 * runs each (JS: the callee written with a dot or a literal subscript, `Reflect.get` and `Reflect['get']`).
 */
export const BY_NAME_PRIMITIVES: { python: readonly ByNamePrimitive[]; js: { object: string; members: readonly ByNamePrimitive[] } } = {
  python: [
    { name: 'getattr', reads: true, args: [2, 3] },
    { name: 'hasattr', reads: false, args: [2, 2] },
    { name: 'setattr', reads: false, args: [3, 3] },
    { name: 'delattr', reads: false, args: [2, 2] },
  ],
  js: {
    object: 'Reflect',
    members: [
      { name: 'get', reads: true, args: [2, 3] },
      { name: 'has', reads: false, args: [2, 2] },
    ],
  },
};

const code = (s: string): string => `\`${s}\``;
const pyCall = (p: ByNamePrimitive): string => code(`${p.name}(pytest, "skip"${p.args[0] === 3 ? ', v' : ''})`);
const jsCalls = (p: ByNamePrimitive): string => `${code(`${BY_NAME_PRIMITIVES.js.object}.${p.name}(it, 'skip')`)}/${code(`${BY_NAME_PRIMITIVES.js.object}['${p.name}'](it, 'skip')`)}`;
const byNameText =
  `a by-name access with a literal name — returning the member, the same member as a dot (a step of a chain that is called or raised): ` +
  `${[...BY_NAME_PRIMITIVES.python.filter((p) => p.reads).map(pyCall), code('getattr(pytest, "skip", default)'), ...BY_NAME_PRIMITIVES.js.members.filter((p) => p.reads).map(jsCalls)].join(', ')}; ` +
  `testing or writing it, transparent (its literal name marks, never a step of a chain): ` +
  `${[...BY_NAME_PRIMITIVES.python.filter((p) => !p.reads).map(pyCall), ...BY_NAME_PRIMITIVES.js.members.filter((p) => !p.reads).map(jsCalls)].join(', ')}`;

/** The forms of the vocabulary (src/parse/vocabulary.ts: every member), rooted at a runner import or at the test context. */
export const BEST_EFFORT_FORMS: readonly GuaranteeEntry[] = [
  { id: 'dot', text: 'a member with a dot (`pytest.skip`, `pytest.mark.skip`, `unittest.SkipTest`, `self.skipTest`, `it.skip`, `test.fail`, `ctx.skip`, `t.skip`)' },
  { id: 'subscript', text: 'a literal subscript, normalised (`it[\'skip\']`, `test[\'fail\']`, `ctx[(\'skip\')]`, `it[\'skip\' as const]`, `pytest.__dict__["skip"]`)' },
  { id: 'by-name', text: byNameText },
];

/** The languages of the guarantee. */
export type GuaranteeLang = 'js' | 'python';

/** A way to access a member by a literal name: all of them are one member access (src/parse/normalise.ts, `memberStep`). */
export interface AccessForm {
  id: string;
  /** The form of the vocabulary it is (BEST_EFFORT_FORMS). */
  group: 'dot' | 'subscript' | 'by-name';
  /** It returns the member: a step of a receiver chain, and a read that is called or raised. */
  reads: boolean;
  /** It may be an assignment target (`R.k = V`, `R['k'] = V`). */
  assignable: boolean;
  /** The access written on a receiver, with a literal name — or, with `key`, with a name that holds it. */
  write: (receiver: string, name: string, key?: string) => string;
}

/** Every access form of a language: a dot, a literal subscript, and each by-name primitive in each of its callee forms and arities. */
export function accessForms(lang: GuaranteeLang): AccessForm[] {
  const q = lang === 'js' ? "'" : '"';
  const lit = (name: string, key?: string): string => key ?? `${q}${name}${q}`;
  const out: AccessForm[] = [
    { id: 'dot', group: 'dot', reads: true, assignable: true, write: (r, k) => `${r}.${k}` },
    { id: 'subscript', group: 'subscript', reads: true, assignable: true, write: (r, k, key) => `${r}[${lit(k, key)}]` },
  ];
  const extra = (n: number): string => (lang === 'js' ? ', undefined' : ', None').repeat(n);
  if (lang === 'python') {
    for (const p of BY_NAME_PRIMITIVES.python) {
      for (let n = p.args[0]; n <= p.args[1]; n++) {
        out.push({ id: `${p.name}/${n}`, group: 'by-name', reads: p.reads, assignable: false, write: (r, k, key) => `${p.name}(${r}, ${lit(k, key)}${extra(n - 2)})` });
      }
    }
  } else {
    const o = BY_NAME_PRIMITIVES.js.object;
    for (const p of BY_NAME_PRIMITIVES.js.members) {
      for (const callee of [`${o}.${p.name}`, `${o}['${p.name}']`]) {
        for (let n = p.args[0]; n <= p.args[1]; n++) {
          out.push({ id: `${callee}/${n}`, group: 'by-name', reads: p.reads, assignable: false, write: (r, k, key) => `${callee}(${r}, ${lit(k, key)}${extra(n - 2)})` });
        }
      }
    }
  }
  return out;
}

/** A receiver the net reads: its root, and how many member steps follow it. */
export interface ReceiverEntry extends GuaranteeEntry {
  id: 'identifier' | 'this-self' | 'chain';
  /** The root: an identifier, `this`/`self`, or either. */
  root: 'identifier' | 'this-self' | 'either';
  /** The steps after the root: none, or one or more (a chain of any length). */
  steps: 'none' | 'one-or-more';
}

/**
 * The receivers of a member target and of the member a use reads (`R.omit = V`, `R['omit'] = V`; `R.omit()`,
 * `R['omit']()`, `Reflect.get(R, 'omit')()`, `getattr(R, "omit")()`): read by one function (src/parse/normalise.ts,
 * `memberChain`), every step a member access however it is written — a dot, a literal subscript, a by-name primitive
 * returning the member — in any position of the chain and of the target.
 */
export const BEST_EFFORT_RECEIVERS: readonly ReceiverEntry[] = [
  { id: 'identifier', root: 'identifier', steps: 'none', text: 'an identifier (`box.omit`, `box[\'omit\']`, `d["k"]`, `Reflect.get(box, \'omit\')`)' },
  { id: 'this-self', root: 'this-self', steps: 'none', text: '`this` (JS/TS) or `self` (Python) (`this.omit`, `this[\'omit\']`, `self.omit`, `self["omit"]`, `getattr(self, "omit")`)' },
  { id: 'chain', root: 'either', steps: 'one-or-more', text: 'a chain on either, every step a member access however written (`a.b.omit`, `this.a[\'b\']`, `a[\'b\'].c`, `getattr(this.a, \'k\')`, `Reflect.get(a[\'b\'], \'k\')`, `self.a["b"].c`)' },
];

/** A concrete receiver of a kind the net reads: as written, the root it starts from, and the access forms of its steps. */
export interface Receiver {
  kind: ReceiverEntry['id'];
  root: 'identifier' | 'this-self';
  steps: readonly AccessForm[];
  text: string;
}

/**
 * Every receiver of BEST_EFFORT_RECEIVERS in a language: each root (`box`; `this` or `self`) bare, and followed by every
 * sequence of 1 to `maxSteps` steps, each step every access form that returns the member (named `a`, `b`, …).
 */
export function receivers(lang: GuaranteeLang, maxSteps: number): Receiver[] {
  const roots: Array<[Receiver['root'], string]> = [['identifier', 'box'], ['this-self', lang === 'js' ? 'this' : 'self']];
  const steps = accessForms(lang).filter((a) => a.reads);
  const out: Receiver[] = [];
  for (const entry of BEST_EFFORT_RECEIVERS) {
    for (const [root, text] of roots) {
      if (entry.root !== 'either' && entry.root !== root) continue;
      if (entry.steps === 'none') {
        out.push({ kind: entry.id, root, steps: [], text });
        continue;
      }
      let level: Array<{ steps: AccessForm[]; text: string }> = [{ steps: [], text }];
      for (let n = 1; n <= maxSteps; n++) {
        level = level.flatMap((r) => steps.map((s) => ({ steps: [...r.steps, s], text: s.write(r.text, String.fromCharCode(96 + n)) })));
        for (const r of level) out.push({ kind: entry.id, root, steps: r.steps, text: r.text });
      }
    }
  }
  return out;
}

/** The roots of the vocabulary the matrix runs. */
export const VOCABULARY_ROOTS: readonly GuaranteeEntry[] = [
  { id: 'import', text: 'a runner import (`import pytest`, `import unittest`, `import pytest as pt`, `from pytest import mark`, `import { it } from \'vitest\'`, `import { test as t2 } from \'node:test\'`)' },
  { id: 'context', text: 'the test context (`self` in a `unittest.TestCase` method, the test callback\'s `ctx`/`t`)' },
];

/** The binding forms that make a name an alias of the vocabulary (one step or in a chain). */
export const BEST_EFFORT_BINDINGS: readonly GuaranteeEntry[] = [
  { id: 'declaration', text: 'a declaration or an assignment (`omit = V`, `const omit = V`, `let omit; omit = V`, an annotated `omit: T = V`)' },
  { id: 'augmented', text: 'an augmented or logical assignment (`+=`, `||=`, `??=`, `&&=`…)' },
  { id: 'walrus', text: 'a walrus (`(omit := V)`)' },
  { id: 'destructuring', text: 'a simple destructuring — object, array, tuple — with literal keys, computed literal keys and defaults (`(omit, x) = (V, 1)`, `const [omit] = [V]`, `const { skip: omit } = it`, `const { [\'skip\']: omit } = ctx`, `const { omit = V } = {}`)' },
  { id: 'parameter-default', text: 'a parameter default (`def f(omit=V)`, `(omit = V) => …`)' },
  { id: 'import-as', text: 'an import under another name (`from pytest import skip as omit`, `import pytest as pt`, `import { it as each } from \'vitest\'`)' },
  { id: 'member-target', text: 'an assignment to a member — a dot or a literal subscript — of a receiver below: `box.omit = V`, `this[\'omit\'] = V`, `this.a[\'b\'] = V`, `self.omit = V`, `d["k"] = V`' },
  { id: 'chain', text: 'an alias of an alias (`later = omit`), through any of the forms above' },
  { id: 'string-key', text: 'a name that holds a string of the vocabulary, used as a key or a by-name access\'s name (`k = "skip"; getattr(pytest, k)`, `const k = \'skip\'; it[k]`, `Reflect.get(ctx, k)`)' },
];

/** Read by the net best effort, outside the matrix: not protected against regressions. */
export const OUTSIDE_THE_MATRIX: readonly GuaranteeEntry[] = [
  { id: 'class-members', text: 'class fields and members, static or not, with a computed name or not (`static [\'omit\'] = it.skip`, `static \'omit\' = ctx.skip`, `static [field] = ctx.skip`)' },
  { id: 'call-writes', text: 'a member written through a call (`setattr(R, "omit", V)`, `Reflect.set(R, \'omit\', V)`, `Object.defineProperty`, `Object.assign`): only an assignment to a dot or a literal subscript binds' },
  { id: 'other-receivers', text: 'a member target or a member read through a receiver outside the ones above: a call (`f().omit`, `getBox()[\'omit\']`) or a subscript computed at run time (`a[k].omit`)' },
  { id: 'enums', text: 'enums and their members (`enum K { S = \'skip\' }`, `class K(Enum): S = "skip"`)' },
  { id: 'containers', text: 'non-literal containers (a `Map`, a value built by a call)' },
  { id: 'functions', text: 'values that enter a function or leave it (`run(omit)`, `r = f(GOOD)`, `key = lambda: "skip"`, a call\'s result called at once, a function declared with `def`/`function`)' },
  { id: 'run-time-names', text: 'names built at run time (`"sk" + "ip"`, a template or an f-string with a substitution)' },
  { id: 'other-modules', text: 'a module imported from another file' },
];


// --- The guarantee: direct forms and the simple alias ----------------------------------------------------------

/** The runners of the guarantee: each one's direct forms have a fixture with its real evidence. */
export type ContractRunner = 'vitest' | 'jest' | 'playwright' | 'node:test' | 'pytest' | 'unittest';

/**
 * Where a member of the vocabulary is written: a modifier of the test root (`test.skip(…)`) or of the suite root
 * (`describe.only(…)`), a root that is a marker itself (`fit(…)`), an annotation in a test's body (Playwright's
 * `test.skip()`), a key of a test's options (`{ skip: true }`), the test context (`ctx.skip()`, `t.skip()`), a pytest
 * mark (`@pytest.mark.skip`), a pytest function (`pytest.skip(…)`), a unittest decorator (`@unittest.skip(…)`) or one
 * imported by name (`from unittest import skip`, `@skip(…)`), the unittest exception (`raise unittest.SkipTest(…)`), the
 * `TestCase` method (`self.skipTest(…)`).
 */
export type ContractShape = 'test' | 'suite' | 'root' | 'annotation' | 'option' | 'context' | 'mark' | 'pytest-call' | 'unittest' | 'decorator' | 'raise' | 'method-call';

/** One combination of the guarantee: a runner, a form, a member, used directly or through a simple alias. */
export interface ContractCase {
  /** `runner/shape/member/form`; Jest's globals `jest/global/<as written>/form`. */
  id: string;
  /** Where its root comes from: the runner's import or the test context, or (Jest) a global with no import. */
  binding: 'import' | 'global';
  lang: GuaranteeLang;
  runner: ContractRunner;
  shape: ContractShape;
  member: string;
  kind: MarkerKind;
  /** `direct`: written from its root; `alias`: bound once to a name in the same file, which is then used. */
  form: 'direct' | 'alias';
  /** The member as written from its root: `test.skip`, `test.describe.only`, `fit`, `skip` (an option's key), `ctx.skip`, `pytest.mark.skip`, `unittest.SkipTest`, `self.skipTest`, `skip` (imported). */
  written: string;
  /** How a use applies it. */
  use: 'call' | 'decorator' | 'raise' | 'option';
}

/**
 * The test context of a JS runner: the parameter of the test callback that has members of the vocabulary, its position,
 * and those members. Vitest's `ctx` and node:test's `t` are the first parameter, their members the runner's API
 * (src/parse/ts-binding.ts, `context`); Playwright's `testInfo` is the second (its first is the fixtures), with
 * `skip()`, `fixme()`, `fail()`: in the guarantee at least a WARN, never a FAIL.
 */
export interface ContractContext {
  name: string;
  param: 0 | 1;
  members: readonly string[];
}

/** Each JS runner of the guarantee: its package, how the fixtures import it, its test and suite roots, its test context. */
export const CONTRACT_JS_RUNNERS: ReadonlyArray<{ runner: ContractRunner; pkg: RunnerPackage; imports: string; test: string; suite: string; context: ContractContext | null }> = [
  { runner: 'vitest', pkg: 'vitest', imports: "import { test, describe } from 'vitest'", test: 'test', suite: 'describe', context: { name: 'ctx', param: 0, members: [...RUNNER_API.vitest.context] } },
  { runner: 'jest', pkg: '@jest/globals', imports: "const { it, describe, fit, … } = require('@jest/globals')", test: 'it', suite: 'describe', context: null },
  { runner: 'playwright', pkg: '@playwright/test', imports: "import { test } from '@playwright/test'", test: 'test', suite: 'test.describe', context: { name: 'testInfo', param: 1, members: ['skip', 'fixme', 'fail'] } },
  { runner: 'node:test', pkg: 'node:test', imports: "import { test, describe } from 'node:test'", test: 'test', suite: 'describe', context: { name: 't', param: 0, members: [...RUNNER_API['node:test'].context] } },
];

/** Jest's globals in the guarantee (no import, `injectGlobals` on): at least a WARN, never a FAIL (docs/rules.md, *Attribution*). */
export const CONTRACT_JEST_GLOBALS = { tests: ['test', 'it'], suite: 'describe' } as const;

/** Every combination of the guarantee: runner × form × member × (direct, alias), from the runners' API and the vocabulary. */
export function contractCases(): ContractCase[] {
  const out: ContractCase[] = [];
  const add = (lang: GuaranteeLang, runner: ContractRunner, shape: ContractShape, member: string, written: string, use: ContractCase['use'], alias: boolean, binding: ContractCase['binding'] = 'import'): void => {
    const kind = (lang === 'js' ? JS_TOKENS : PY_TOKENS)[member];
    if (kind === undefined) throw new Error(`guarantee: ${member} is not a member of the vocabulary`);
    for (const form of alias ? (['direct', 'alias'] as const) : (['direct'] as const)) {
      const id = binding === 'global' ? `${runner}/global/${written}/${form}` : `${runner}/${shape}/${member}/${form}`;
      out.push({ id, binding, lang, runner, shape, member, kind, form, written, use });
    }
  };
  for (const r of CONTRACT_JS_RUNNERS) {
    const api = RUNNER_API[r.pkg];
    for (const m of api.testMarkers) add('js', r.runner, 'test', m, `${r.test}.${m}`, 'call', true);
    for (const m of api.suiteMarkers) add('js', r.runner, 'suite', m, `${r.suite}.${m}`, 'call', true);
    for (const m of api.rootMarkers) add('js', r.runner, 'root', m, m, 'call', true);
    for (const m of api.annotations) add('js', r.runner, 'annotation', m, `${r.test}.${m}`, 'call', true);
    for (const m of api.options) add('js', r.runner, 'option', m, m, 'option', false);
    for (const m of r.context?.members ?? []) add('js', r.runner, 'context', m, `${r.context!.name}.${m}`, 'call', true);
  }
  // Jest's globals, with no import: every test root, the suite root and the roots that are a marker.
  const jest = RUNNER_API['@jest/globals'];
  for (const t of CONTRACT_JEST_GLOBALS.tests) for (const m of jest.testMarkers) add('js', 'jest', 'test', m, `${t}.${m}`, 'call', true, 'global');
  for (const m of jest.suiteMarkers) add('js', 'jest', 'suite', m, `${CONTRACT_JEST_GLOBALS.suite}.${m}`, 'call', true, 'global');
  for (const m of jest.rootMarkers) add('js', 'jest', 'root', m, m, 'call', true, 'global');
  for (const m of Object.keys(PY_MARK_KINDS)) add('python', 'pytest', 'mark', m, `pytest.mark.${m}`, 'decorator', true);
  for (const m of Object.keys(PY_PYTEST_CALL_KINDS)) add('python', 'pytest', 'pytest-call', m, `pytest.${m}`, 'call', true);
  for (const m of Object.keys(PY_UNITTEST_DECORATORS)) add('python', 'unittest', 'unittest', m, `unittest.${m}`, 'decorator', true);
  for (const m of Object.keys(PY_UNITTEST_DECORATORS)) add('python', 'unittest', 'decorator', m, m, 'decorator', false);
  for (const m of Object.keys(PY_UNITTEST_EXCEPTIONS)) add('python', 'unittest', 'raise', m, `unittest.${m}`, 'raise', true);
  for (const m of Object.keys(PY_TESTCASE_METHODS)) add('python', 'unittest', 'method-call', m, `self.${m}`, 'call', true);
  return out;
}

/**
 * Combinations whose fixture waits on a decision about the FAIL side, each with its reason: kept out of the fixtures
 * until the decision is implemented (test/contract-fixtures.test.ts holds each to having no fixture yet, and to
 * docs/backlog.md).
 */
export const CONTRACT_PENDING: ReadonlyArray<{ id: string; reason: string }> = [];

const RUNNER_NAMES: Record<ContractRunner, string> = { vitest: 'Vitest', jest: 'Jest', playwright: 'Playwright', 'node:test': 'node:test', pytest: 'pytest', unittest: 'unittest' };

/** The direct forms of one runner, as docs/rules.md lists them. */
function directForms(runner: ContractRunner, binding: ContractCase['binding'] = 'import'): string {
  const cases = contractCases().filter((c) => c.runner === runner && c.binding === binding && c.form === 'direct');
  const shapes = [...new Set(cases.map((c) => c.shape))];
  const write = (c: ContractCase): string => {
    switch (c.shape) {
      case 'option': return code(`{ ${c.member}: true }`);
      case 'annotation': return code(`${c.written}()`);
      case 'context': return code(`${c.written}()`);
      case 'mark': case 'unittest': case 'decorator': return code(`@${c.written}`);
      case 'raise': return code(`raise ${c.written}`);
      default: return code(`${c.written}(…)`);
    }
  };
  const label: Record<ContractShape, string> = {
    test: 'on the test root', suite: 'on the suite root', root: 'roots that are a marker', annotation: 'annotations in a test\'s body',
    option: 'options of a test', context: 'the test context', mark: 'marks', 'pytest-call': 'functions', unittest: 'decorators',
    decorator: 'decorators imported by name (`from unittest import skip`)', raise: 'the exception', 'method-call': 'the `TestCase` method',
  };
  return shapes.map((s) => `${label[s]}: ${cases.filter((c) => c.shape === s).map(write).join(', ')}`).join('; ');
}

/** The guarantee as docs/rules.md states it, between its markers. */
export function renderGuarantee(): string {
  const cases = contractCases();
  const js = CONTRACT_JS_RUNNERS.map((r) => `    - ${RUNNER_NAMES[r.runner]} (${code(r.imports)}${r.context ? `; the context, the test callback's ${r.context.param === 0 ? 'first' : 'second'} parameter ${code(r.context.name)}` : ''}) — ${directForms(r.runner)}`);
  return [
    'Two things block a merge, and nothing else:',
    '',
    '- **No false `FAIL`** — unchanged: a `FAIL` is a fact about the code, under the four documented assumptions (*Verdicts* and *The contract*, above), for the canonical forms of the whitelist (*Verdicts*).',
    '- **No silence for the direct forms** — a new use of one of these, at head, is at least a `WARN` naming its test:',
    '  - **a member of the vocabulary used directly from its root**, a runner import or the test context:',
    ...js,
    `    - Jest\'s globals, with no import (at least a \`WARN\`, never a \`FAIL\`: *Attribution*) — ${directForms('jest', 'global')}`,
    `    - pytest (${code('import pytest')}) — ${directForms('pytest')}`,
    `    - unittest (${code('import unittest')}, ${code('from unittest import skip')}; the context, \`self\` in a \`unittest.TestCase\` method) — ${directForms('unittest')}`,
    '  - **a simple alias in the same file**: a name bound once, by a plain declaration or assignment, to one of those members — the member itself, not a call of it — and used as the member would be (`const later = test.skip; later(\'x\', …)`, `later = pytest.mark.skip` then `@later`, `stop = unittest.SkipTest` then `raise stop("x")`, `omit = self.skipTest; omit("x")`); for every form above but an option and a decorator imported by name.',
    '',
    `Each combination — runner × form × member, direct and through the alias: ${cases.length}, generated from the runners\' API (src/parse/ts-binding.ts) and the vocabulary (src/parse/vocabulary.ts) — has a fixture with the real runner\'s evidence (\`test/contract-fixtures.test.ts\`)${CONTRACT_PENDING.length === 0 ? '.' : `, but ${CONTRACT_PENDING.length} that wait on a decision about the \`FAIL\` side:`}`,
    ...CONTRACT_PENDING.map((p) => `- ${code(p.id)}: ${p.reason}.`),
    '',
    'Everything else the nets catch is *Best-effort detection* (below), with no guarantee.',
  ].join('\n');
}

const list = (entries: readonly GuaranteeEntry[]): string => entries.map((e) => `  - ${e.text}`).join('\n');

/** Best-effort detection as docs/rules.md states it, between its markers: what the nets read today, with no guarantee. */
export function renderBestEffort(): string {
  return [
    '- **Uses**, read identically (one extraction of the callee, the same transparent by-name primitives):',
    list(BEST_EFFORT_USES),
    '- **Forms of the vocabulary** — every member of its table (*Safety nets*, src/parse/vocabulary.ts) — rooted at',
    list(VOCABULARY_ROOTS),
    '  and written as',
    list(BEST_EFFORT_FORMS),
    '- **Aliases** (one step or in a chain) bound by',
    list(BEST_EFFORT_BINDINGS),
    '- **Receivers** of a member target and of the member a use reads:',
    list(BEST_EFFORT_RECEIVERS),
    '- **Runner globals** with no import (Jest\'s, Vitest\'s globals, Mocha\'s): a form of the vocabulary on them is always a `WARN` "may be skipped", never a `FAIL`.',
    '- **Outside the matrix** — read by the net best effort, with no test against regressions:',
    list(OUTSIDE_THE_MATRIX),
  ].join('\n');
}
