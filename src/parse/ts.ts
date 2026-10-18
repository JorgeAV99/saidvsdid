// Test inventory for JavaScript/TypeScript suites: vitest, jest, mocha-style
// and Playwright Test. The forms are found on tree-sitter's syntax tree; which
// declaration a name is, the TypeScript compiler says (src/parse/ts-binding.ts).
// Nothing is executed or type-checked.
//
// Attribution principle: a skip/focus marker is attached to tests only where
// it certainly applies — a test declaration itself, directly in a test or
// describe body, directly in an inline hook of that block, or at the file top
// level. Anything inside another function (helpers, callbacks, methods, hooks
// passed by reference) is recorded in the marker census as unattributed; the
// rules report such markers as WARN when they are new.
//
// The runner's API by binding (src/parse/ts-binding.ts): an attached marker,
// a test and an assertion carry a Binding — certain only through a static
// import of a runner whose API has that form, the only declaration the
// compiler gives the name. Everything shaped like the API but not certain (a
// global, a local wrapper, a parameter, a helper's export, `x.skip()` on
// something that is not the test's context) is attached all the same, with the
// reason: the rules warn on it themselves, never FAIL, never silence. A literal
// subscript is a member access: `it['skip']` is `it.skip`, escapes decoded.
import type { Node } from 'web-tree-sitter';
import { classifyGuards, normaliseBody, snippet, type Guard } from './conditions.js';
import { tsAssertions, tsFileInfo, tsHelperCalls, type TsFileInfo } from './ts-assert.js';
import { jsKey, jsMember, jsName, unwrap } from './normalise.js';
import { JS_CONTEXT_MEMBERS, RUNNER_API, TsResolver, type RunnerPackage, type TsAlias } from './ts-binding.js';
import { markerEffect } from '../rules/effects.js';
import { sameName, testOrdinals } from '../rules/ids.js';
import { numberLiteral } from '../config/values.js';
import { CANONICAL, CERTAIN, firstNotCanonical, notCanonical, oneEffect, uncertain, weakest, type Assertion, type MarkerForm, type Binding, type Knob, type Marker, type MarkerCondition, type MarkerKind, type MarkerSite, type ScopeReading, type TestCase } from './types.js';
import { nameTable } from '../util/names.js';
import { JS_CONDITIONAL_SEGMENTS, JS_OPTION_MARKERS, JS_ROOT_MARKERS, JS_SEGMENT_MARKERS, JS_TEST_ROOTS } from './vocabulary.js';

const TEST_ROOTS = JS_TEST_ROOTS;
const SUITE_ROOTS = new Set(['describe', 'suite', 'context']);
const HOOK_NAMES = new Set(['beforeEach', 'beforeAll', 'afterEach', 'afterAll', 'before', 'after']);
// The vocabulary (src/parse/vocabulary.ts, the one definition).
const ROOT_MARKERS = JS_ROOT_MARKERS;
const SEGMENT_MARKERS = JS_SEGMENT_MARKERS;
const CONDITIONAL_SEGMENTS = JS_CONDITIONAL_SEGMENTS;
/** Property names that make any `x.<name>` a marker occurrence for the census (a test-root-only one: on a test root). */
const CENSUS_PROPERTIES: Readonly<Record<string, MarkerKind>> = nameTable('CENSUS_PROPERTIES', Object.fromEntries(
  [...Object.entries(SEGMENT_MARKERS), ...Object.entries(CONDITIONAL_SEGMENTS)].filter(([n]) => SEGMENT_MARKERS[n]?.testRootOnly !== true).map(([n, v]) => [n, v.kind]),
));
const NEUTRAL_SEGMENTS = new Set(['each', 'for', 'concurrent', 'sequential', 'parallel', 'serial', 'shuffle']);
const FUNCTION_TYPES = new Set(['arrow_function', 'function_expression', 'function']);
const FUNCTION_LIKE = new Set([
  ...FUNCTION_TYPES,
  'function_declaration',
  'generator_function',
  'generator_function_declaration',
  'method_definition',
]);
const STRING_TYPES = new Set(['string', 'template_string']);

interface Segment {
  name: string;
  node: Node;
  /** Arguments when the segment is itself called, e.g. `.skipIf(cond)` or `.each(table)`. */
  args: Node[] | null;
}

interface SuiteNode {
  type: 'suite';
  name: string | null;
  binding: Binding;
  markers: Marker[];
  children: Array<SuiteNode | TestNode>;
  /** `describe.each(table)` arguments, normalised. */
  params: string;
  /** Whether it and every describe around it are declared in a canonical form (F3, F4); the file: canonical. */
  form: MarkerForm;
  /** Markers written on it whose literal condition never applies (`describe.skipIf(false)`): F6 counts them. */
  inert: string[];
}

interface TestNode {
  type: 'test';
  name: string;
  line: number;
  body: string;
  params: string;
  assertionSites: Assertion[];
  helperCalls: string[];
  markers: Marker[];
  binding: Binding;
  /** Whether it and every describe around it are declared in a canonical form (F3, F4). */
  form: MarkerForm;
  /** Markers written on it whose literal condition never applies (`{ fails: false }`, `ctx.skip(false)`): F6 counts them. */
  inert: string[];
}

/** The test or inline-hook callback whose first parameter is the runner context. */
interface Context {
  fn: Node;
  /** How certainly the callback is the runner's: its declaration or hook and every one around it. */
  binding: Binding;
  /** The runner, when certain: which members its context has (RUNNER_API, `context`). */
  pkg: RunnerPackage | null;
}

interface Scope {
  suite: SuiteNode;
  test: TestNode | null;
  /**
   * The test or inline-hook callback whose first parameter is the runner
   * context (`(ctx) => ...`, `({ skip }) => ...`); `ctx.skip()` is the
   * context's only if `ctx` resolves to that parameter.
   */
  ctx: Context | null;
  /** The function whose body this scope is (guards are collected up to here). */
  boundary: Node | null;
  /** Markers here certainly apply to `test` / `suite` (see the header comment). */
  certain: boolean;
  /** Structural path of this scope, used for marker site ids. */
  path: string;
  /** The declarations and hooks around this scope: the weakest of their bindings. */
  binding: Binding;
}

/** A marker token found in a declaration's callee (`it.only`, `fit`, `.skipIf(c)`). */
interface DeclToken {
  node: Node;
  /** The marker's name, escapes decoded (`skip` for `.skip`, `['skip']` and `.\u0073kip`): its site's form. */
  form: string;
  kind: MarkerKind;
  checked: boolean;
  /** null: the marker never applies (e.g. `skipIf(false)`). */
  condition: MarkerCondition | null;
  /** Snippet for reports, when the callee alone does not show the marker (options). */
  text?: string;
  /** Whether this marker is part of the certain runner's API (see RUNNER_API). */
  binding: Binding;
}

interface Declaration {
  kind: 'test' | 'suite';
  name: string;
  fn: Node | null;
  tokens: DeclToken[];
  text: string;
  /** Arguments that may hold markers used indirectly: `.each([it.only])` tables. */
  indirect: Node[];
  /** How certainly the callee is the runner's test API. */
  binding: Binding;
  /** The runner, when certain. */
  pkg: RunnerPackage | null;
  /** Whether its call is canonical apart from where it stands (F3's callee and arguments, F4's options), and no option that a modifier also sets. */
  form: MarkerForm;
}

interface Annotation {
  kind: MarkerKind;
  checked: boolean;
  /** Guards from the annotation's own arguments (`test.skip(cond)`, `ctx.skip(cond)`). */
  guards: Guard[];
  /** The token that names the marker (`skip` in `test.skip()`), for the census. */
  token: Node;
  binding: Binding;
  /** The runner, when certain: the marker's effect is its (src/rules/effects.ts). */
  pkg: RunnerPackage | null;
  /** A member of the test's context (`ctx.skip()`, `t.todo()`), not the API's own annotation (`test.skip()`). */
  context: boolean;
}

type Classified = { type: 'declaration'; decl: Declaration } | { type: 'annotation'; ann: Annotation } | null;

const line = (n: Node): number => n.startPosition.row + 1;

function args(call: Node): Node[] {
  const a = call.childForFieldName('arguments');
  if (!a) return [];
  // Tagged templates (`describe.each\`...\``) have a template_string as arguments.
  if (a.type === 'template_string') return [a];
  return a.namedChildren.filter((c) => c.type !== 'comment');
}

/** Flattens `test.describe.only`, `it.each(t)`, `it.skipIf(c)`, `(it as any).skip` into root + segments. */
function chain(written: Node): Segment[] | null {
  const fn = unwrap(written);
  if (fn.type === 'identifier') return [{ name: jsName(fn), node: fn, args: null }];
  const member = jsMember(fn);
  if (member) {
    const base = chain(member.object);
    return base ? [...base, { name: member.name, node: member.property, args: null }] : null;
  }
  if (fn.type === 'call_expression') {
    const inner = fn.childForFieldName('function');
    const base = inner ? chain(inner) : null;
    if (!base || base.length < 2) return null;
    const last = base[base.length - 1]!;
    if (last.args) return null; // `a(b)(c)(d)` is not a test API shape
    last.args = args(fn);
    return base;
  }
  return null;
}

function stringValue(node: Node): string {
  if (node.type === 'string') return node.text.slice(1, -1);
  if (node.type === 'template_string') return node.text.slice(1, -1);
  return node.text;
}

/**
 * Guards between `node` and `stop`, with polarity: the `else` branch of an
 * `if`, the alternative of a ternary and the right side of `||` apply when the
 * condition is false.
 */
function guardsBetween(node: Node, stop: Node | null): Guard[] {
  const guards: Guard[] = [];
  let child = node;
  for (let p = node.parent; p && p.id !== stop?.id; child = p, p = p.parent) {
    if (p.type === 'if_statement' || p.type === 'ternary_expression') {
      const cond = p.childForFieldName('condition');
      if (!cond || cond.id === child.id) continue;
      const alternative = p.childForFieldName('alternative');
      guards.push({ text: cond.text, negated: alternative?.id === child.id });
    } else if (p.type === 'binary_expression') {
      const op = p.childForFieldName('operator')?.text;
      const left = p.childForFieldName('left');
      const right = p.childForFieldName('right');
      if (left && right?.id === child.id && (op === '&&' || op === '||')) {
        guards.push({ text: left.text, negated: op === '||' });
      }
    }
  }
  return guards.reverse();
}

const isApiName = (n: string): boolean => Boolean(ROOT_MARKERS[n]) || TEST_ROOTS.has(n) || SUITE_ROOTS.has(n);

/** The root of the test API a callee stands for, and how certainly it is the runner's. */
interface ApiRoot {
  /** The API name: `it` for `check` in `import { it as check } from 'vitest'`, `it` in `v.it(…)`. */
  name: string;
  node: Node;
  rest: Segment[];
  /** The runner, when the root is certainly its export of that name. */
  pkg: RunnerPackage | null;
  binding: Binding;
}

function exported(pkg: RunnerPackage, name: string): { pkg: RunnerPackage | null; binding: Binding } {
  const api = RUNNER_API[pkg];
  return api.tests.has(name) || api.suites.has(name) || api.rootMarkers.has(name)
    ? { pkg, binding: CERTAIN }
    : { pkg: null, binding: uncertain(`${pkg} does not export \`${name}\``) };
}

/** A form of the vocabulary written as an expression: `it.skip`, `test['only']`, `it.skipIf(c)`, `fit`. */
function vocabularyForm(node: Node): boolean {
  const n = unwrap(node);
  if (n.type === 'identifier') return Boolean(ROOT_MARKERS[jsName(n)]);
  if (n.type === 'call_expression') {
    const fn = n.childForFieldName('function');
    const member = fn ? jsMember(unwrap(fn)) : null;
    return Boolean(member && CONDITIONAL_SEGMENTS[member.name]);
  }
  const member = jsMember(n);
  return Boolean(member && (SEGMENT_MARKERS[member.name] || CONDITIONAL_SEGMENTS[member.name]));
}

/**
 * The expressions a binding's value makes a name stand for: the value itself when it is exactly what
 * the name holds, then every form of the vocabulary it contains, in source order.
 */
function aliasCandidates(alias: TsAlias): Node[] {
  const contained = [alias.value, ...alias.value.descendantsOfType(['identifier', 'member_expression', 'subscript_expression', 'call_expression'])].filter(vocabularyForm);
  return alias.exact ? [alias.value, ...contained] : contained;
}

/**
 * `it(…)`, `check(…)` (an aliased import), `v.it(…)` (a namespace), and anything else shaped like the
 * test API (`it` from a helper, a global, a parameter, `jg.it(…)` on a required namespace): uncertain.
 * An alias (`const omit = test.skip; omit(…)`, or any binding whose value contains a form of the
 * vocabulary: `const [omit] = [it.skip]`, a default, `for (const omit of [it.skip])`) is read as what
 * it aliases, uncertain, its segments placed at the use.
 */
/** A form of the vocabulary that a name's value holds: the chain it stands for, and where that chain is rooted. */
interface AliasForm {
  /** The chain the name stands for: `it.skip` for `const { skip: omit } = it`, `t.skip.bind(t)` for `omit ||= t.skip.bind(t)`. */
  segs: Segment[];
  /** `context`: rooted in the test's context parameter (vitest's `ctx`, node:test's `t`); `api`: anything else, read against the runners. */
  root: 'context' | 'api';
  /** Whether the name holds the chain itself (`const omit = it.skip`), or a value that contains it. */
  whole: boolean;
  why: string;
}

/**
 * The one reading of aliases (docs/rules.md, *Aliases*), for every binding form: the values the compiler
 * shows a name is given (resolver.aliasOf: declarations, parameter and destructuring defaults, every
 * assignment operator, destructuring with literal keys, `for`), each form of the vocabulary they
 * contain, and its root — the context parameter of the test callback `ctxFn`, or anything else (a
 * runner import, a global), which apiRoot reads against the runners' APIs.
 */
function aliasForms(use: Node, resolver: TsResolver, ctxFn: Node | null): AliasForm[] {
  const name = jsName(use);
  const out: AliasForm[] = [];
  for (const alias of resolver.aliasOf(use)) {
    for (const candidate of aliasCandidates(alias)) {
      const base = chain(candidate);
      if (!base || base.length === 0) continue;
      // `const { skip: omit } = it`: `omit` is `it.skip`.
      const segs = alias.member && candidate.id === alias.value.id ? [...base, { name: alias.member.name, node: alias.member.node, args: null }] : base;
      const shown = snippet(alias.value.text, 60);
      const whole = candidate.id === alias.value.id;
      const why = whole
        ? `\`${name}\` is an alias of \`${shown}\` (line ${alias.line})`
        : `\`${name}\` is bound (line ${alias.line}) to a value that contains \`${snippet(candidate.text, 40)}\` (\`${shown}\`)`;
      const role = ctxFn && segs[0]!.node.type === 'identifier' ? resolver.contextRole(segs[0]!.node, ctxFn) : null;
      out.push({ segs, root: role && 'role' in role && role.role === 'object' && !('alias' in role) ? 'context' : 'api', whole, why });
    }
  }
  return out;
}

function apiRoot(segs: Segment[], resolver: TsResolver, followAlias = true): ApiRoot | null {
  const [first, second] = segs;
  if (!first || first.node.type !== 'identifier') return null;
  for (const form of followAlias ? aliasForms(first.node, resolver, null) : []) {
    const inner = apiRoot([...form.segs, ...segs.slice(1)], resolver, false);
    const fromAlias = new Set(form.segs);
    // Only an alias of the vocabulary: `const test = base.extend({…})` is a test API of its own, not an alias.
    if (inner && inner.rest.filter((s) => fromAlias.has(s)).every((s) => SEGMENT_MARKERS[s.name] || CONDITIONAL_SEGMENTS[s.name] || NEUTRAL_SEGMENTS.has(s.name) || s.name === 'describe')) {
      return {
        name: inner.name,
        node: first.node,
        rest: inner.rest.map((s) => (fromAlias.has(s) ? { ...s, node: first.node } : s)),
        pkg: null,
        binding: uncertain(form.why),
      };
    }
  }
  const b = resolver.root(first.node);
  if (b.kind === 'import' && isApiName(b.imported)) return { name: b.imported, node: first.node, rest: segs.slice(1), ...exported(b.pkg, b.imported) };
  if (b.kind === 'namespace' && second && isApiName(second.name)) return { name: second.name, node: second.node, rest: segs.slice(2), ...exported(b.pkg, second.name) };
  const why = b.kind === 'uncertain' ? b.why : b.kind === 'import' ? `\`${first.name}\` is ${b.pkg}'s \`${b.imported}\`` : `\`${first.name}\` is ${b.pkg}'s namespace`;
  if (b.kind !== 'namespace' && isApiName(first.name)) return { name: first.name, node: first.node, rest: segs.slice(1), pkg: null, binding: uncertain(why) };
  if (second && isApiName(second.name)) return { name: second.name, node: second.node, rest: segs.slice(2), pkg: null, binding: uncertain(why) };
  return null;
}

/** Whether a marker modifier belongs to the certain runner's API for that kind of declaration. */
function modifierBinding(root: ApiRoot, kind: 'test' | 'suite', marker: string, set: 'markers' | 'annotations' | 'options'): Binding {
  if (!root.pkg) return root.binding;
  const api = RUNNER_API[root.pkg];
  const allowed = set === 'annotations' ? api.annotations : set === 'options' ? api.options : kind === 'suite' ? api.suiteMarkers : api.testMarkers;
  if (!allowed.has(marker)) return uncertain(`\`${marker}\` is not part of ${root.pkg}'s ${set === 'options' ? 'test options' : `${kind} API`}`);
  if (marker === 'only' && api.focusNeedsFlag) return uncertain(`${root.pkg} applies \`only\` only with ${api.focusNeedsFlag}`);
  return CERTAIN;
}

function classifyCall(call: Node, resolver: TsResolver): Classified {
  const fnNode = call.childForFieldName('function');
  if (!fnNode) return null;
  const segs = chain(fnNode);
  if (!segs) return null;
  const root = apiRoot(segs, resolver);
  if (!root) return null;
  const rest = root.rest;
  let binding = root.binding;

  let kind: 'test' | 'suite';
  const tokens: DeclToken[] = [];
  const indirect: Node[] = [];
  const rootMarker = ROOT_MARKERS[root.name];
  if (rootMarker) {
    kind = rootMarker.suite ? 'suite' : 'test';
    tokens.push({ node: root.node, form: root.name, kind: rootMarker.kind, checked: rootMarker.kind === 'only', condition: 'unconditional', binding: rootMarker.kind === 'only' ? modifierBinding(root, kind, 'only', 'markers') : root.binding });
  } else if (TEST_ROOTS.has(root.name)) {
    kind = 'test';
  } else {
    kind = 'suite';
  }

  // F3's callee: `<api>[.modifier]` (Playwright's `test.describe[.modifier]`), one modifier at most, a conditional one
  // only with the literal that makes it apply (`skipIf(true)`, `runIf(false)`); no `.each`, `.concurrent`, … .
  let callee: MarkerForm = CANONICAL;
  let modifiers = rootMarker ? 1 : 0;
  for (const seg of rest) {
    const segMarker = SEGMENT_MARKERS[seg.name];
    const conditional = CONDITIONAL_SEGMENTS[seg.name];
    if (segMarker || conditional) modifiers++;
    if (modifiers > 1) callee = firstNotCanonical(callee, notCanonical(`its callee \`${snippet(fnNode.text, 40)}\` has more than one modifier`));
    if (conditional) {
      const want = conditional.negated ? 'false' : 'true';
      if (seg.args?.length !== 1 || seg.args[0]!.type !== want) callee = firstNotCanonical(callee, notCanonical(`\`.${seg.name}(…)\` is not written with the literal \`${want}\`, so whether it applies is not certain`));
    } else if (!segMarker && !(seg.name === 'describe' && root.name === 'test')) {
      callee = firstNotCanonical(callee, notCanonical(`its callee \`${snippet(fnNode.text, 40)}\` is not the runner's API with one modifier`));
    }
  }

  for (const seg of rest) {
    const segMarker = SEGMENT_MARKERS[seg.name];
    const conditional = CONDITIONAL_SEGMENTS[seg.name];
    if (seg.name === 'describe' && root.name === 'test') {
      kind = 'suite'; // Playwright: test.describe(...)
      if (root.pkg && root.pkg !== '@playwright/test') binding = weakest(binding, uncertain(`\`test.describe\` is not part of ${root.pkg}'s API`));
    } else if (segMarker) {
      if (seg.args) return null;
      tokens.push({ node: seg.node, form: seg.name, kind: segMarker.kind, checked: segMarker.checked, condition: 'unconditional', binding: modifierBinding(root, kind, seg.name, 'markers') });
    } else if (conditional) {
      const cond = seg.args?.[0];
      if (!cond) return null;
      tokens.push({ node: seg.node, form: seg.name, kind: 'skip', checked: false, condition: classifyGuards([{ text: cond.text, negated: conditional.negated }]), binding: modifierBinding(root, kind, seg.name, 'markers') });
    } else if (NEUTRAL_SEGMENTS.has(seg.name)) {
      indirect.push(...(seg.args ?? []));
    } else {
      return null; // test.step, test.use, test.beforeEach, describe.configure, ...
    }
  }

  const callArgs = args(call);
  const first = callArgs[0];
  const fn = callArgs.slice(1).find((a) => FUNCTION_TYPES.has(a.type)) ?? null;
  // Vitest / node:test options: it('x', { skip: true }, fn), { only }, { todo }, { fails }.
  for (const options of callArgs.slice(1).filter((a) => a.type === 'object')) tokens.push(...optionTokens(options, fnNode.text, root, kind));

  // Playwright annotations: test.skip(), test.skip(cond, 'why'), test.fixme(({ browserName }) => ...).
  const annotation = rest.length === 1 ? SEGMENT_MARKERS[rest[0]!.name] : undefined;
  if (kind === 'test' && annotation && annotation.kind !== 'only' && (!first || !STRING_TYPES.has(first.type))) {
    return {
      type: 'annotation',
      ann: {
        kind: annotation.kind,
        checked: annotation.checked,
        guards: first ? [{ text: first.text, negated: false }] : [],
        token: rest[0]!.node,
        binding: modifierBinding(root, 'test', rest[0]!.name, 'annotations'),
        pkg: root.pkg,
        context: false,
      },
    };
  }

  if (!first) return null;
  const bodyless = tokens.some((t) => t.kind === 'todo' || t.kind === 'skip');
  if (!fn && !(bodyless && STRING_TYPES.has(first.type))) return null;
  if (FUNCTION_TYPES.has(first.type)) return null;
  // A callee merely shaped like the runner's through a namespace (`jg.it`) declares a test only with a name.
  if (!root.pkg && root.node.id !== segs[0]!.node.id && !STRING_TYPES.has(first.type)) return null;

  return { type: 'declaration', decl: { kind, name: stringValue(first), fn, tokens, text: snippet(fnNode.text), indirect, binding, pkg: binding.certain ? root.pkg : null, form: firstNotCanonical(callee, declarationForm(callArgs, fn, tokens, kind, binding.certain ? root.pkg : null)) } };
}

const OPTION_MARKERS = JS_OPTION_MARKERS;

/** F4: the keys each runner documents for a test's (or a describe's) options, and the literals each takes. */
type OptionType = 'boolean' | 'number' | 'string';
const VITEST_OPTIONS: Readonly<Record<string, readonly OptionType[]>> = nameTable('VITEST_OPTIONS', {
  skip: ['boolean'], only: ['boolean'], todo: ['boolean'], fails: ['boolean'], concurrent: ['boolean'], sequential: ['boolean'], shuffle: ['boolean'],
  timeout: ['number'], retry: ['number'], repeats: ['number'],
});
const NODE_TEST_OPTIONS: Readonly<Record<string, readonly OptionType[]>> = nameTable('NODE_TEST_OPTIONS', {
  skip: ['boolean', 'string'], todo: ['boolean', 'string'], only: ['boolean'], timeout: ['number'], plan: ['number'], concurrency: ['boolean', 'number'],
});
/** The runners whose tests take an options object, and where: `test(name, options, fn)`. */
const DOCUMENTED_OPTIONS: Readonly<Partial<Record<RunnerPackage, Readonly<Record<string, readonly OptionType[]>>>>> = nameTable('DOCUMENTED_OPTIONS', { vitest: VITEST_OPTIONS, 'node:test': NODE_TEST_OPTIONS });
/**
 * The runners that take a timeout after the callback (`test(name, fn, 5000)`), and with which modifiers, as each
 * documents its signatures: Vitest's every test API; Jest's `test`, `test.only`, `test.failing` and `fit` — not
 * `test.skip(name, fn)`, `xit`/`xtest(name, fn)` or `test.todo(name)`.
 */
const TRAILING_TIMEOUT: Readonly<Partial<Record<RunnerPackage, ReadonlySet<string> | 'any'>>> = nameTable('TRAILING_TIMEOUT', {
  vitest: 'any',
  '@jest/globals': new Set(['only', 'failing', 'fit']),
});
/** Modifiers a runner documents with a name alone, and no callback: Jest's `test.todo(name)` (Jest aborts the file otherwise). */
const NAME_ONLY: Readonly<Partial<Record<RunnerPackage, ReadonlySet<string>>>> = nameTable('NAME_ONLY', { '@jest/globals': new Set(['todo']) });

/** The literal type a node is, exactly as written (no parentheses, no expression): null for anything else. */
function literalType(node: Node): OptionType | null {
  if (node.type === 'true' || node.type === 'false') return 'boolean';
  if (node.type === 'number') return 'number';
  if (node.type === 'string') return 'string';
  return null;
}

/** A name written as a string literal, or a template with no substitution. */
function plainName(node: Node): boolean {
  return node.type === 'string' || (node.type === 'template_string' && !node.namedChildren.some((c) => c.type === 'template_substitution'));
}

/**
 * F3's arguments and F4's options (docs/rules.md, *Verdicts*): a name written as a string literal (or a template with no
 * substitution), a function literal in its position, and nothing else but what the runner documents there — options
 * `test(name, { … }, fn)` for Vitest and node:test, a literal timeout `test(name, fn, 5000)` for Vitest and Jest, no
 * callback for a todo. Options: an object literal whose keys, written as identifiers or strings, are unique and among
 * the runner's documented ones, each a literal of the type it takes, no spread, no computed key, no method. Also, no
 * modifier of the callee (`test.skip`, `fit`, `.skipIf(true)`) is set again by an option, whose precedence is the
 * runner's. When the runner is not certain, its binding says why: the arguments are not read.
 */
function declarationForm(callArgs: Node[], fn: Node | null, tokens: readonly DeclToken[], kind: 'test' | 'suite', pkg: RunnerPackage | null): MarkerForm {
  if (pkg === null) return CANONICAL;
  const [name, ...rest] = callArgs;
  if (!name || !plainName(name)) return notCanonical(`its name \`${snippet(name?.text ?? '', 30)}\` is not a string literal`);
  const documented = DOCUMENTED_OPTIONS[pkg];
  const todo = tokens.some((t) => t.kind === 'todo');
  // The modifiers of the callee (not options): each runner documents a signature per modifier.
  const modifiers = tokens.filter((t) => t.text === undefined).map((t) => t.form);
  const nameOnly = modifiers.find((m) => NAME_ONLY[pkg]?.has(m));
  if (nameOnly !== undefined && callArgs.length !== 1) return notCanonical(`${pkg} documents \`${nameOnly}\` with a name alone, and this call passes more`);
  const timeout = TRAILING_TIMEOUT[pkg];
  const timeoutAllowed = timeout === 'any' || (timeout !== undefined && modifiers.every((m) => timeout.has(m)));
  let options: Node | null = null;
  let shape: boolean;
  if (fn === null) {
    // A body-less todo: `test.todo('x')`, node:test's `test('x', { todo: true })`.
    shape = todo && (rest.length === 0 || (rest.length === 1 && documented !== undefined && rest[0]!.type === 'object'));
    options = rest.length === 1 ? rest[0]! : null;
  } else if (!FUNCTION_TYPES.has(fn.type)) {
    shape = false;
  } else if (rest.length === 1) {
    shape = rest[0]!.id === fn.id;
  } else if (rest.length === 2 && rest[1]!.id === fn.id) {
    shape = documented !== undefined && rest[0]!.type === 'object';
    options = rest[0]!;
  } else if (rest.length === 2 && rest[0]!.id === fn.id) {
    shape = kind === 'test' && timeoutAllowed && rest[1]!.type === 'number';
  } else {
    shape = false;
  }
  if (!shape) return notCanonical(`its arguments \`(${snippet(callArgs.map((a) => a.text).join(', '), 50)})\` are not one of the forms ${pkg} documents for a ${kind} (a name, then ${documented ? 'options, then ' : ''}the callback)`);
  let optionKey: string | null = null;
  if (options) {
    const seen = new Set<string>();
    for (const prop of options.namedChildren) {
      if (prop.type === 'comment') continue;
      if (prop.type === 'spread_element') return notCanonical('its options object has a spread (`...`), so what it sets is not written in it');
      const keyNode = prop.type === 'pair' ? prop.childForFieldName('key') : null;
      if (!keyNode || (keyNode.type !== 'property_identifier' && keyNode.type !== 'string')) return notCanonical(`its options object has an entry that is not \`key: literal\` (\`${snippet(prop.text, 30)}\`)`);
      const key = jsKey(keyNode);
      if (key === null) return notCanonical(`its options object has a key that is not written as a literal (\`${snippet(prop.text, 30)}\`)`);
      if (seen.has(key)) return notCanonical(`its options object sets \`${key}\` twice; which one the runner keeps is not written in the call`);
      seen.add(key);
      const types = Object.hasOwn(documented!, key) ? documented![key]! : null;
      if (types === null) return notCanonical(`its options object sets \`${key}\`, which is not one of ${pkg}'s documented options`);
      const value = prop.childForFieldName('value');
      const type = value ? literalType(value) : null;
      if (type === null || !types.includes(type)) return notCanonical(`its option \`${snippet(prop.text, 30)}\` is not a ${types.join(' or ')} literal`);
      if (Object.hasOwn(OPTION_MARKERS, key)) optionKey ??= key;
    }
  }
  // A modifier of the callee (`test.skip`, `fit`, `.skipIf(true)`): the tokens that are not options.
  const modifier = tokens.find((t) => t.text === undefined);
  if (optionKey !== null && modifier) return notCanonical(`its options also set \`${optionKey}\`, which the runner weighs against \`${modifier.form}\` by its own precedence`);
  return CANONICAL;
}

/** `{ skip: true }`, `{ only: cond }`, `{ todo }` in a test's options object. */
function optionTokens(options: Node, callee: string, root: ApiRoot, kind: 'test' | 'suite'): DeclToken[] {
  const out: DeclToken[] = [];
  for (const prop of options.namedChildren) {
    let key: Node | null = null;
    let value: Node | null = null;
    if (prop.type === 'pair') {
      key = prop.childForFieldName('key');
      value = prop.childForFieldName('value');
    } else if (prop.type === 'shorthand_property_identifier') {
      key = prop;
      value = prop;
    }
    const name = key ? (jsKey(key) ?? undefined) : undefined;
    const spec = name ? OPTION_MARKERS[name] : undefined;
    if (!key || !value || !spec || !name) continue;
    const condition = classifyGuards([{ text: value.text, negated: false }]);
    out.push({ node: key, form: name, kind: spec.kind, checked: spec.checked, condition, text: snippet(`${callee}(…, { ${prop.text} })`), binding: modifierBinding(root, kind, name, 'options') });
  }
  return out;
}

/**
 * `beforeEach(...)`, `test.beforeEach(...)`, `test.describe.beforeAll(...)`: the hook's binding, or null
 * when the call is not shaped like a hook. Certain for a hook statically imported from a runner that
 * exports it, and Playwright's `test.<hook>`.
 */
function hookCall(call: Node, resolver: TsResolver): { binding: Binding; pkg: RunnerPackage | null } | null {
  const fn = call.childForFieldName('function');
  const segs = fn ? chain(fn) : null;
  if (!segs) return null;
  const last = segs[segs.length - 1]!;
  if (!HOOK_NAMES.has(last.name) || last.args) return null;
  if (segs.length === 1) {
    if (segs[0]!.node.type !== 'identifier') return null;
    const b = resolver.root(segs[0]!.node);
    if (b.kind === 'import' && b.imported === last.name && RUNNER_API[b.pkg].hooks.has(last.name) && b.pkg !== '@playwright/test') return { binding: CERTAIN, pkg: b.pkg };
    return { binding: uncertain(b.kind === 'uncertain' ? b.why : `\`${last.name}\` is not ${b.kind === 'import' ? `${b.pkg}'s \`${b.imported}\`` : 'a hook'}`), pkg: null };
  }
  if (!(TEST_ROOTS.has(segs[0]!.name) || SUITE_ROOTS.has(segs[0]!.name))) return null;
  const root = apiRoot(segs, resolver);
  if (!root) return null;
  if (root.pkg === '@playwright/test' && root.name === 'test' && (segs.length === 2 || (segs.length === 3 && segs[1]!.name === 'describe'))) return { binding: CERTAIN, pkg: root.pkg };
  return { binding: root.pkg ? uncertain(`\`${segs.map((s) => s.name).join('.')}\` is not part of ${root.pkg}'s API`) : root.binding, pkg: null };
}

/** A function literal passed directly to a hook call: `beforeEach(() => ...)`. */
function inlineHookOf(fn: Node, resolver: TsResolver): { binding: Binding; pkg: RunnerPackage | null } | null {
  if (!FUNCTION_TYPES.has(fn.type)) return null;
  const argsNode = fn.parent;
  const call = argsNode?.type === 'arguments' ? argsNode.parent : null;
  return call?.type === 'call_expression' ? hookCall(call, resolver) : null;
}

/** Whether the first parameter of a test or hook callback of `pkg` is a context with `skip()`. */
/** A member of the vocabulary on the context of a callback whose declaration or hook has `binding`. */
function contextBinding(binding: Binding, pkg: RunnerPackage | null, member: string): Binding {
  if (!binding.certain) return binding;
  if (!pkg) return uncertain('the runner of the test is not certain');
  const api = RUNNER_API[pkg];
  if (!api.context.has(member)) return uncertain(`${pkg}'s test callback receives no context with \`${member}()\``);
  if (JS_CONTEXT_MEMBERS[member] === 'only' && api.focusNeedsFlag) return uncertain(`${pkg} applies \`${member}\` only with ${api.focusNeedsFlag}`);
  return CERTAIN;
}

function functionName(fn: Node): string {
  const own = fn.childForFieldName('name');
  if (own) return own.text;
  const parent = fn.parent;
  if (parent?.type === 'variable_declarator') return parent.childForFieldName('name')?.text ?? 'anon';
  if (parent?.type === 'pair') return parent.childForFieldName('key')?.text ?? 'anon';
  if (parent?.type === 'assignment_expression') return parent.childForFieldName('left')?.text ?? 'anon';
  return 'anon';
}

/**
 * `ctx.skip()` / `ctx['skip']()` / `ctx.skip(cond)` / `t.todo()` / `skip()` in a test or inline-hook callback: a member
 * of the vocabulary on the test context (JS_CONTEXT_MEMBERS), the context's when `ctx` is that callback's context
 * parameter (certain when the callback's declaration is and its runner's context has that member: RUNNER_API,
 * `context`). A one-step alias of the context or of its member (`({ skip: omit }) => omit()`, `const s = ctx.skip`) is
 * read as it, never certain; any other receiver, or a bare `skip()` that is not the context's, is shaped like it: an
 * uncertain marker, never silence.
 */
function contextMember(call: Node, scope: Scope, resolver: TsResolver): Annotation | null {
  if (!scope.ctx) return null;
  const ctx = scope.ctx;
  const fn = call.childForFieldName('function');
  if (!fn) return null;
  const callee = unwrap(fn);
  const callArgs = args(call);
  const guards = callArgs.length > 0 && !STRING_TYPES.has(callArgs[0]!.type) ? [{ text: callArgs[0]!.text, negated: false }] : [];
  const member = jsMember(callee);
  let use: Node;
  let token: Node;
  // `object`: `ctx.<member>()`, the receiver is read; `member-fn`: a bare call, the callee is read.
  let wanted: 'object' | 'member-fn';
  let name: string;
  if (member && Object.hasOwn(JS_CONTEXT_MEMBERS, member.name) && unwrap(member.object).type === 'identifier') {
    [use, token, wanted, name] = [unwrap(member.object), member.property, 'object', member.name];
  } else if (callee.type === 'identifier') {
    [use, token, wanted, name] = [callee, callee, 'member-fn', jsName(callee)];
  } else {
    return null;
  }
  const at = (m: string, binding: Binding): Annotation => ({ kind: JS_CONTEXT_MEMBERS[m]!, checked: false, guards, token, binding, pkg: ctx.pkg, context: true });
  const role = resolver.contextRole(use, ctx.fn);
  if ('role' in role && role.role === 'object' && wanted === 'object') return at(name, contextBinding(ctx.binding, ctx.pkg, name));
  if ('role' in role && role.role === 'member-fn' && wanted === 'member-fn') return at(role.member, uncertain(role.alias));
  // A one-step alias rooted in the context, by any binding form: `const c = ctx` then `c.skip()`;
  // `const s = ctx.skip`, `omit ||= t.skip.bind(t)`, `const [omit = t.todo] = []` then `omit()`.
  for (const form of aliasForms(use, resolver, ctx.fn)) {
    if (form.root !== 'context') continue;
    const tail = form.segs.slice(1).map((s) => s.name);
    const found = wanted === 'member-fn' ? tail.find((t) => Object.hasOwn(JS_CONTEXT_MEMBERS, t)) : tail.length === 0 ? name : undefined;
    if (found !== undefined) return at(found, uncertain(form.why));
  }
  // A bare call is shaped like a member of the context only by its name.
  if (wanted === 'member-fn' && !Object.hasOwn(JS_CONTEXT_MEMBERS, name)) return null;
  const why = 'why' in role ? role.why : `\`${jsName(use)}\` is not the context parameter of the test's callback`;
  return at(name, uncertain(why));
}

/** What a statement or expression that holds a call is, for a WARN that says where it is. */
const TS_ENCLOSING: ReadonlyMap<string, string> = new Map([
  ['if_statement', 'an `if`'], ['else_clause', 'an `else`'], ['for_statement', 'a `for` loop'], ['for_in_statement', 'a `for` loop'],
  ['while_statement', 'a `while` loop'], ['do_statement', 'a `do` loop'], ['try_statement', 'a `try`'], ['catch_clause', 'a `catch`'],
  ['finally_clause', 'a `finally`'], ['switch_statement', 'a `switch`'], ['switch_case', 'a `case`'], ['switch_default', 'a `default`'],
  ['with_statement', 'a `with`'], ['labeled_statement', 'a labelled statement'], ['ternary_expression', 'a conditional expression'],
  ['binary_expression', 'an expression'], ['augmented_assignment_expression', 'an assignment'], ['assignment_expression', 'an assignment'],
  ['call_expression', 'another call'], ['arguments', 'the arguments of another call'],
  ['arrow_function', 'a nested function'], ['function_expression', 'a nested function'], ['function_declaration', 'a nested function'],
  ['generator_function_declaration', 'a nested function'], ['method_definition', 'a nested function'], ['class_body', 'a class'],
]);

/** Where a call stands, said for a WARN: the first construct around it (up to `stop`) that decides whether it runs. */
function holderOf(call: Node, stop: Node | null): string {
  for (let p = call.parent; p && p.id !== stop?.id; p = p.parent) {
    const where = TS_ENCLOSING.get(p.type);
    if (where) return `it is inside ${where}, so it may not run`;
  }
  return 'it is not a statement of its own, so what holds it decides whether it runs';
}

/** The statement a call is exactly: `call;` or `await call;` (no parentheses, nothing else); null otherwise. */
function ownStatement(call: Node): Node | null {
  const holder = call.parent?.type === 'await_expression' && call.parent.namedChildren.length === 1 ? call.parent : call;
  const stmt = holder.parent;
  return stmt?.type === 'expression_statement' && stmt.namedChildren.length === 1 ? stmt : null;
}

/**
 * F2 (docs/rules.md, *Verdicts*): a call in a test's callback is canonical only when it is the first statement of the
 * callback's block body and the statement is exactly the call (`ctx.skip();`, `await ctx.skip();`), with an allowed
 * signature: `ctx.skip()`, `ctx.skip("…")`, `t.skip()`, `t.skip("…")`, `t.todo()`, `t.todo("…")` on the test's
 * context, Playwright's `test.skip()`, `test.fixme()`, `test.fail()` with no argument. Anything else is a WARN that says
 * where it is or what it is passed.
 */
function tsFirstStatementForm(call: Node, fn: Node, ann: Annotation): MarkerForm {
  const body = fn.childForFieldName('body');
  if (!body || body.type !== 'statement_block') return notCanonical("the test's body is an expression, not a block whose first statement it is");
  const stmt = ownStatement(call);
  const first = body.namedChildren.find((c) => c.type !== 'comment') ?? null;
  if (stmt === null) return notCanonical(holderOf(call, body));
  if (first === null || first.id !== stmt.id) {
    return notCanonical(stmt.parent?.id === body.id && first
      ? `it is not the first statement of the test's body (the first is at line ${first.startPosition.row + 1}), so what comes before it decides whether it runs`
      : holderOf(stmt, body));
  }
  const callArgs = args(call);
  const ok = ann.context ? callArgs.length === 0 || (callArgs.length === 1 && callArgs[0]!.type === 'string') : callArgs.length === 0;
  return ok ? CANONICAL : notCanonical(`its arguments are not one of the forms the rule reads (${ann.context ? 'none, or a string literal' : 'none'}), so what it does is not certain`);
}

/** The first `return`, `throw` or `yield` in `node`, outside the functions and classes it defines. */
function firstTsExit(node: Node): Node | null {
  if (node.type === 'return_statement' || node.type === 'throw_statement' || node.type === 'yield_expression') return node;
  if (FUNCTION_LIKE.has(node.type) || node.type === 'class_declaration' || node.type === 'class') return null;
  for (const child of node.namedChildren) {
    const exit = firstTsExit(child);
    if (exit) return exit;
  }
  return null;
}

/**
 * F3 (docs/rules.md, *Verdicts*): a describe's callback, or the file, whose own code holds a `return` or a `throw`
 * (anywhere outside the functions it defines) may stop before what it declares: none of its declarations is canonical.
 */
function exitForm(scope: Node | null): MarkerForm {
  const body = scope === null ? null : scope.type === 'program' ? scope : scope.childForFieldName('body');
  if (!body || (body.type !== 'statement_block' && body.type !== 'program')) return CANONICAL;
  for (const stmt of body.namedChildren) {
    const exit = firstTsExit(stmt);
    if (exit && exit.type !== 'yield_expression') {
      const what = exit.type === 'return_statement' ? 'return' : 'throw';
      return notCanonical(`${scope!.type === 'program' ? 'the file' : "the describe's callback"} has a \`${what}\` at line ${exit.startPosition.row + 1}, so it may stop before declaring it`);
    }
  }
  return CANONICAL;
}

/**
 * F3 (docs/rules.md, *Verdicts*): a declaration is canonical where it stands only as an expression statement that is
 * exactly the call, directly in the file's top level or directly in the block body of a describe's callback (itself
 * canonical: SuiteNode.form). No `if`, no loop, no function in between.
 */
function placementForm(call: Node, scope: Scope): MarkerForm {
  const stmt = call.parent?.type === 'expression_statement' && call.parent.namedChildren.length === 1 ? call.parent : null;
  if (stmt === null) return notCanonical(holderOf(call, scope.boundary));
  const holder = stmt.parent;
  if (scope.suite.name === null && scope.boundary === null) return holder?.type === 'program' ? CANONICAL : notCanonical(holderOf(stmt, null));
  const describeBody = !scope.test && !scope.ctx && scope.boundary ? scope.boundary.childForFieldName('body') : null;
  if (describeBody?.type === 'statement_block' && holder?.id === describeBody.id) return CANONICAL;
  return notCanonical(describeBody ? holderOf(stmt, describeBody) : "it is not a statement of the file or of a describe's callback");
}

function scopeKind(scope: Scope): Marker['scope'] {
  return scope.test ? 'test' : scope.suite.name === null ? 'file' : 'suite';
}

/** A literal number, possibly written as a product/sum of literals (`60 * 1000`). */
function numeric(node: Node | undefined): number | null {
  if (!node) return null;
  if (node.type === 'number') return numberLiteral(node.text);
  if (node.type === 'parenthesized_expression') return numeric(node.namedChildren[0]);
  if (node.type === 'binary_expression') {
    const l = numeric(node.childForFieldName('left') ?? undefined);
    const r = numeric(node.childForFieldName('right') ?? undefined);
    const op = node.childForFieldName('operator')?.text;
    if (l === null || r === null) return null;
    return op === '*' ? l * r : op === '+' ? l + r : op === '-' ? l - r : null;
  }
  return null;
}

interface OptionKnob {
  kind: Knob['kind'];
  value: number | null;
  at: Node;
  name: string;
}

/** `{ timeout: n, retry: n }` (vitest test/describe options, Playwright `describe.configure`). */
/** The knobs an options object sets, by key: `vi.setConfig({ testTimeout })`, `test.describe.configure({ timeout, retries })`, `it('x', { timeout, retry }, fn)`. */
const VI_CONFIG_KNOBS: Readonly<Record<string, Knob['kind']>> = nameTable('VI_CONFIG_KNOBS', { testTimeout: 'timeout' });
const CONFIGURE_KNOBS: Readonly<Record<string, Knob['kind']>> = nameTable('CONFIGURE_KNOBS', { timeout: 'timeout', retries: 'retry' });
const TEST_OPTION_KNOBS: Readonly<Record<string, Knob['kind']>> = nameTable('TEST_OPTION_KNOBS', { timeout: 'timeout', retry: 'retry' });

function optionKnobs(options: Node, names: Readonly<Record<string, Knob['kind']>>): OptionKnob[] {
  const out: OptionKnob[] = [];
  for (const prop of options.namedChildren) {
    if (prop.type !== 'pair') continue;
    const key = prop.childForFieldName('key');
    const name = key?.type === 'string' ? key.text.slice(1, -1) : key?.text;
    const kind = name ? names[name] : undefined;
    if (!kind || !key || !name) continue;
    out.push({ kind, value: numeric(prop.childForFieldName('value') ?? undefined), at: key, name });
  }
  return out;
}

/** Argument shapes that pass test options we cannot read. */
const OPAQUE_OPTIONS = new Set(['identifier', 'member_expression', 'call_expression', 'subscript_expression', 'spread_element']);

interface PendingKnob {
  knob: Omit<Knob, 'test'>;
  test: TestNode | null;
}

class Extractor {
  readonly sites: MarkerSite[] = [];
  readonly knobs: PendingKnob[] = [];
  private readonly ordinals = new Map<string, number>();

  constructor(
    private readonly info: TsFileInfo,
    private readonly resolver: TsResolver,
  ) {}

  private next(key: string): number {
    const n = this.ordinals.get(key) ?? 0;
    this.ordinals.set(key, n + 1);
    return n;
  }

  /** `parent/segment`, disambiguated when the same segment repeats under one parent. */
  private childPath(parent: string, segment: string): string {
    const n = this.next(`path\0${parent}/${segment}`);
    return `${parent}/${segment}${n > 0 ? `#${n}` : ''}`;
  }

  private record(path: string, form: string, kind: MarkerKind, at: Node, text: string, attributed: boolean): string {
    const key = `${path}/${form}`;
    const site = `${key}#${this.next(`site\0${key}`)}`;
    this.sites.push({ site, kind, line: line(at), text, attributed });
    return site;
  }

  visit(node: Node, scope: Scope): void {
    if (FUNCTION_LIKE.has(node.type) && node.id !== scope.boundary?.id) {
      // Entering a function other than the current test/describe callback.
      const hook = scope.certain && !scope.test ? inlineHookOf(node, this.resolver) : null;
      const hookBinding = hook ? weakest(scope.binding, hook.binding) : scope.binding;
      const inner: Scope = hook
        ? {
            ...scope,
            ctx: { fn: node, binding: hookBinding, pkg: hook.pkg },
            boundary: node,
            binding: hookBinding,
            path: this.childPath(scope.path, `hook:${node.parent!.parent!.childForFieldName('function')!.text}`),
          }
        : { ...scope, boundary: node, certain: false, path: this.childPath(scope.path, `fn:${functionName(node)}`) };
      this.visit(node, inner);
      return;
    }

    if (node.type === 'call_expression') {
      const classified = classifyCall(node, this.resolver);
      if (classified?.type === 'declaration') {
        this.declare(node, classified.decl, scope);
        return;
      }
      if (classified?.type === 'annotation') {
        this.annotate(node, classified.ann, scope);
        return;
      }
      // `ctx.skip()` on the test's context, or a call shaped like it: never silence.
      const ctxCall = contextMember(node, scope, this.resolver);
      if (ctxCall) {
        this.annotate(node, ctxCall, scope);
        return;
      }
      this.callKnobs(node, scope);
      const callee = node.childForFieldName('function');
      if (callee?.type === 'identifier' && ROOT_MARKERS[jsName(callee)]) {
        const root = ROOT_MARKERS[jsName(callee)]!;
        this.record(scope.path, jsName(callee), root.kind, callee, snippet(node.text), false);
      }
    } else if (node.type === 'member_expression' || node.type === 'subscript_expression') {
      // Any other `x.skip` / `x['only']` / ...: aliases, helpers taking ctx, etc.
      const member = jsMember(node);
      const object = member?.object;
      const kind = member ? (CENSUS_PROPERTIES[member.name] ?? (SEGMENT_MARKERS[member.name]?.testRootOnly && object?.type === 'identifier' && TEST_ROOTS.has(jsName(object)) ? SEGMENT_MARKERS[member.name]!.kind : undefined)) : undefined;
      if (member && kind) {
        const call = node.parent?.type === 'call_expression' && node.parent.childForFieldName('function')?.id === node.id ? node.parent : node;
        this.record(scope.path, member.name, kind, member.property, snippet(call.text), false);
      }
    }
    for (const child of node.namedChildren) this.visit(child, scope);
  }

  private addKnob(scope: Scope, test: TestNode | null, kind: Knob['kind'], value: number | null, form: string, at: Node, text: string): void {
    const key = `${scope.path}/${kind}:${form}`;
    this.knobs.push({ knob: { kind, value, form, line: line(at), text: snippet(text), key: `${key}#${this.next(`knob\0${key}`)}` }, test });
  }

  /** jest.setTimeout, vi.setConfig({ testTimeout }), test.setTimeout, test.slow(), jest.retryTimes, describe.configure, this.timeout/retries. */
  private callKnobs(call: Node, scope: Scope): void {
    const fn = call.childForFieldName('function');
    const segs = fn ? chain(fn) : null;
    if (!segs || segs.length < 2) return;
    const names = segs.map((x) => x.name).join('.');
    const a = args(call);
    const target = scope.test;
    const onTestRoot = segs.length === 2 && TEST_ROOTS.has(segs[0]!.name);
    if (names === 'jest.setTimeout' || names === 'this.timeout' || (onTestRoot && segs[1]!.name === 'setTimeout')) {
      const form = onTestRoot ? 'test.setTimeout' : names;
      this.addKnob(scope, target, 'timeout', numeric(a[0]), form, call, call.text);
    } else if (onTestRoot && segs[1]!.name === 'slow' && a.length === 0) {
      this.addKnob(scope, target, 'timeout', null, 'test.slow', call, call.text);
    } else if (names === 'vi.setConfig' && a[0]?.type === 'object') {
      for (const k of optionKnobs(a[0], VI_CONFIG_KNOBS)) this.addKnob(scope, target, k.kind, k.value, 'vi.setConfig', k.at, call.text);
    } else if (names === 'jest.retryTimes' || names === 'this.retries') {
      this.addKnob(scope, target, 'retry', numeric(a[0]), names, call, call.text);
    } else if (segs[segs.length - 1]!.name === 'configure' && segs.some((x) => x.name === 'describe') && a[0]?.type === 'object') {
      for (const k of optionKnobs(a[0], CONFIGURE_KNOBS)) {
        this.addKnob(scope, target, k.kind, k.value, `describe.configure.${k.name}`, k.at, call.text);
      }
    }
  }

  private annotate(node: Node, ann: Annotation, scope: Scope): void {
    const text = snippet(node.text);
    // The site's form is the callee's names (`ctx.skip` for `ctx['skip']` too), else its text.
    const callee = node.childForFieldName('function')!;
    const form = chain(callee)?.map((s) => s.name).join('.') ?? snippet(callee.text, 40);
    const site = this.record(scope.path, form, ann.kind, node, text, scope.certain);
    if (!scope.certain) {
      this.visitArgs(node, scope);
      return;
    }
    const condition = classifyGuards([...guardsBetween(node, scope.boundary), ...ann.guards]);
    if (condition === null) (scope.test ?? scope.suite).inert.push(text);
    if (condition !== null) {
      const form = scope.test && scope.boundary && scope.ctx?.fn.id === scope.boundary.id
        ? firstNotCanonical(scope.test.form, tsFirstStatementForm(node, scope.boundary, ann))
        : notCanonical(scope.ctx ? "it is in a hook, not in the test's body" : `it is in ${scope.suite.name === null ? 'the file' : "a describe's body"}, not in a test's body`);
      (scope.test ?? scope.suite).markers.push({ kind: ann.kind, condition, checked: ann.checked, line: line(node), site, text, scope: scopeKind(scope), binding: weakest(scope.binding, ann.binding), effect: markerEffect(ann.pkg, ann.kind), form });
    }
    this.visitArgs(node, scope);
  }

  /** Arguments of an annotation may themselves contain markers (callbacks). */
  private visitArgs(call: Node, scope: Scope): void {
    const a = call.childForFieldName('arguments');
    if (a) this.visit(a, scope);
  }

  private declare(node: Node, decl: Declaration, scope: Scope): void {
    // A test declared inside another test is not collected by any runner we
    // support; a declaration inside a helper may or may not run.
    const collected = !scope.test;
    const attributed = collected && scope.certain;
    // Its own callee and every declaration around it; inside a helper function it may never run.
    const binding = attributed ? weakest(scope.binding, decl.binding) : uncertain(`it is declared inside a function (line ${scope.boundary ? line(scope.boundary) : line(node)}), which may not run`);
    const path = this.childPath(scope.path, `${decl.kind}:${JSON.stringify(decl.name)}`);
    // F3 and F4: the describes around it, where it stands, its callee, arguments and options.
    const form = firstNotCanonical(scope.suite.form, placementForm(node, scope), decl.form);
    // Markers inside `.each` tables are used indirectly: census only.
    for (const arg of decl.indirect) this.visit(arg, { ...scope, certain: false, path: `${path}/args` });
    const markers: Marker[] = [];
    const inert: string[] = [];
    for (const t of decl.tokens) {
      const site = this.record(path, t.form, t.kind, t.node, t.text ?? decl.text, attributed);
      if (attributed && t.condition === null) inert.push(t.text ?? decl.text);
      if (attributed && t.condition !== null) {
        markers.push({ kind: t.kind, condition: t.condition, checked: t.checked, line: line(t.node), site, text: t.text ?? decl.text, scope: 'test', binding: weakest(binding, t.binding), effect: markerEffect(decl.pkg, t.kind), form });
      }
    }

    /** `it('x', fn, 30000)`, `it('x', { timeout, retry }, fn)`, `describe('x', { retry }, fn)`. */
    const declKnobs = (test: TestNode | null): void => {
      if (!collected) return;
      const callArgs = args(node);
      const fnAt = decl.fn ? callArgs.findIndex((x) => x.id === decl.fn!.id) : -1;
      const trailing = fnAt === -1 ? undefined : callArgs[fnAt + 1];
      const inner = { ...scope, path };
      // `it('x', fn, 30000)`; a non-literal (`TIMEOUT`) is recorded without a value.
      if (trailing) this.addKnob(inner, test, 'timeout', numeric(trailing), 'arg', trailing, trailing.text);
      for (const options of callArgs.slice(1, fnAt === -1 ? undefined : fnAt)) {
        if (options.type === 'object') {
          for (const k of optionKnobs(options, TEST_OPTION_KNOBS)) this.addKnob(inner, test, k.kind, k.value, `options.${k.name}`, k.at, node.text);
        } else if (OPAQUE_OPTIONS.has(options.type)) {
          this.addKnob(inner, test, 'options', null, 'options', options, options.text);
        }
      }
    };

    const params = decl.indirect.map((a) => normaliseBody(a.text)).join(' | ');
    if (decl.kind === 'suite') {
      const suite: SuiteNode = { type: 'suite', name: decl.name, binding, markers, children: [], params, form: firstNotCanonical(form, exitForm(decl.fn)), inert };
      declKnobs(null);
      if (collected) scope.suite.children.push(suite);
      if (decl.fn) {
        this.visit(decl.fn, { suite, test: null, ctx: null, boundary: decl.fn, certain: attributed, path, binding });
      }
      return;
    }
    const bodyNode = decl.fn?.childForFieldName('body') ?? null;
    const test: TestNode = {
      type: 'test',
      name: decl.name,
      line: line(node),
      body: bodyNode ? normaliseBody(bodyNode.text) : '',
      params,
      assertionSites: bodyNode ? tsAssertions(bodyNode, this.info) : [],
      helperCalls: bodyNode ? tsHelperCalls(bodyNode, this.info) : [],
      markers,
      binding,
      form,
      inert,
    };
    if (collected) scope.suite.children.push(test);
    declKnobs(test);
    if (decl.fn) {
      this.visit(decl.fn, { suite: scope.suite, test, ctx: { fn: decl.fn, binding, pkg: decl.pkg }, boundary: decl.fn, certain: attributed, path, binding });
    }
  }
}

function flatten(suite: SuiteNode, path: string[], inherited: Marker[], out: TestCase[], names: Map<TestNode, string>, params: string[] = [], inheritedInert: string[] = []): void {
  const scopeOf = (m: Marker): Marker => (m.scope === 'test' ? { ...m, scope: 'suite' } : m);
  const markers = [...inherited, ...suite.markers.map(scopeOf)];
  const inert = [...inheritedInert, ...suite.inert];
  const tables = suite.params ? [...params, suite.params] : params;
  for (const child of suite.children) {
    if (child.type === 'suite') {
      flatten(child, [...path, child.name ?? ''], markers, out, names, tables, inert);
    } else {
      names.set(child, [...path, child.name].join(' > '));
      // A marker of a describe around it is canonical for this test only when the test's declaration is (F3).
      const own = (m: Marker): Marker => (child.form.canonical || !m.form.canonical ? m : { ...m, form: child.form });
      out.push({
        name: [...path, child.name].join(' > '),
        ordinal: 0,
        declaration: child.form,
        line: child.line,
        body: child.body,
        params: [...tables, child.params].filter(Boolean).join(' | '),
        assertions: child.assertionSites.length,
        assertionSites: child.assertionSites,
        helperCalls: child.helperCalls,
        markers: oneEffect([...markers, ...child.markers].map(own), [...inert, ...child.inert]),
        marks: [],
        binding: child.binding,
      });
    }
  }
}

export interface TsExtraction {
  tests: TestCase[];
  markerSites: MarkerSite[];
  knobs: Knob[];
  playwright: boolean;
  nodeTest: boolean;
  scopes: ScopeReading;
}

export function extractTsTests(root: Node, source: string, path: string): TsExtraction {
  const file: SuiteNode = { type: 'suite', name: null, binding: CERTAIN, markers: [], children: [], params: '', form: exitForm(root), inert: [] };
  const info = tsFileInfo(root, source, path);
  const extractor = new Extractor(info, info.resolver);
  extractor.visit(root, { suite: file, test: null, ctx: null, boundary: null, certain: true, path: '', binding: CERTAIN });
  const tests: TestCase[] = [];
  const names = new Map<TestNode, string>();
  flatten(file, [], [], tests, names);
  // The identity of each test (src/rules/ids.ts); a repeated full name leaves which test the runner reports uncertain.
  testOrdinals(tests.map((t) => t.name), 'typescript').forEach((n, i) => (tests[i]!.ordinal = n));
  for (const t of tests) {
    const n = sameName(tests, t.name);
    if (n < 2) continue;
    const why = notCanonical(`the file declares ${n} tests named ${JSON.stringify(t.name)}, so which one the runner reports is not certain`);
    t.declaration = firstNotCanonical(t.declaration, why);
    t.markers = t.markers.map((m) => (m.form.canonical ? { ...m, form: why } : m));
  }
  const knobs = extractor.knobs.map(({ knob, test }): Knob => ({ ...knob, test: test ? (names.get(test) ?? null) : null }));
  const specs = [...info.imports.values()];
  return { tests, markerSites: extractor.sites, knobs, playwright: specs.includes('@playwright/test'), nodeTest: specs.includes('node:test'), scopes: info.resolver.scopes };
}
