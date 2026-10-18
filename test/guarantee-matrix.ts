// The best-effort detection's matrix (src/rules/guarantee.ts; docs/rules.md, *Best-effort detection*): a regression
// test of what the contagion net reads today, not a guarantee. Generated from the sources: the full cartesian product of its axes — binding form × member of the vocabulary × root × access form of the
// value × receiver × access form of the target × access form of the read × use — every combination either a case or
// excluded by an entry of MATRIX_EXCLUSIONS, with its reason. Shared by test/silence-guarantee.test.ts and by the
// scripts that run it whole.
import { JS_CONDITIONAL_SEGMENTS, JS_CONTEXT_MARKERS, JS_ROOT_MARKERS, JS_SEGMENT_MARKERS, PY_MARK_KINDS, PY_PYTEST_CALL_KINDS, PY_TESTCASE_METHODS, PY_UNITTEST_DECORATORS, PY_UNITTEST_EXCEPTIONS } from '../src/parse/vocabulary.js';
import { accessForms, BEST_EFFORT_BINDINGS, BEST_EFFORT_USES, receivers, type AccessForm, type GuaranteeLang, type Receiver } from '../src/rules/guarantee.js';

export type Lang = GuaranteeLang;
export type Use = 'call' | 'decorator' | 'raise';

/** How many member steps a chain receiver of the matrix has at most (MATRIX_EXCLUSIONS says why). */
export const MAX_CHAIN_STEPS = 2;

// --- the axes, from the sources ----------------------------------------------------------------------

/** A root of the vocabulary: a runner import or the test context. */
export interface Root {
  id: string;
  kind: 'import' | 'context';
  lang: Lang;
  imports: string;
  name: string;
  /** JS: the test that holds a context's body. */
  wrap?: (body: string) => string;
}

/** A member of the vocabulary, on the root it hangs from: the object that holds it, written from the root's name. */
export interface Member {
  lang: Lang;
  name: string;
  root: Root;
  owner: (root: string) => string;
}

const PY_ROOTS: Record<'pytest' | 'unittest' | 'self', Root> = {
  pytest: { id: 'pytest', kind: 'import', lang: 'python', imports: 'import pytest', name: 'pytest' },
  unittest: { id: 'unittest', kind: 'import', lang: 'python', imports: 'import unittest', name: 'unittest' },
  self: { id: 'self', kind: 'context', lang: 'python', imports: 'import unittest', name: 'self' },
};
const JS_ROOTS: Record<'it' | 'ctx' | 't' | 'g', Root> = {
  it: { id: 'it', kind: 'import', lang: 'js', imports: "import { it } from 'vitest';", name: 'it' },
  ctx: { id: 'ctx', kind: 'context', lang: 'js', imports: "import { it } from 'vitest';", name: 'ctx', wrap: (body) => `it('a', (ctx) => {\n${body}\n});` },
  t: { id: 't', kind: 'context', lang: 'js', imports: "import { test } from 'node:test';", name: 't', wrap: (body) => `test('a', (t) => {\n${body}\n});` },
  g: { id: 'g', kind: 'import', lang: 'js', imports: "import * as g from '@jest/globals';\nimport { it } from 'vitest';", name: 'g' },
};

/** Every member of the vocabulary (src/parse/vocabulary.ts), on each root it hangs from. */
export function members(lang: Lang): Member[] {
  const of = (table: Readonly<Record<string, unknown>>, root: Root, owner: (r: string) => string): Member[] => Object.keys(table).map((name) => ({ lang, name, root, owner }));
  if (lang === 'python') {
    return [
      ...of(PY_MARK_KINDS, PY_ROOTS.pytest, (r) => `${r}.mark`),
      ...of(PY_UNITTEST_DECORATORS, PY_ROOTS.unittest, (r) => r),
      ...of(PY_PYTEST_CALL_KINDS, PY_ROOTS.pytest, (r) => r),
      ...of(PY_TESTCASE_METHODS, PY_ROOTS.self, (r) => r),
      ...of(PY_UNITTEST_EXCEPTIONS, PY_ROOTS.unittest, (r) => r),
    ];
  }
  const modifiers = { ...JS_SEGMENT_MARKERS, ...JS_CONDITIONAL_SEGMENTS };
  return [
    ...of(modifiers, JS_ROOTS.it, (r) => r),
    ...of(modifiers, JS_ROOTS.ctx, (r) => r),
    ...of(modifiers, JS_ROOTS.t, (r) => r),
    ...of(JS_CONTEXT_MARKERS, JS_ROOTS.t, (r) => r),
    ...of(JS_ROOT_MARKERS, JS_ROOTS.g, (r) => r),
  ];
}

/** The uses the net reads (BEST_EFFORT_USES). */
export const USES: readonly Use[] = BEST_EFFORT_USES.map((u) => u.id as Use);

/** A binding form's variant: its id in BEST_EFFORT_BINDINGS and the number of the variant. */
export interface BindingVariant {
  id: string;
  variant: number;
  /** A member target: it runs over the receivers and the target and read access forms. */
  member: boolean;
}

/** The variants of each binding form the net reads, per language (`direct`: the use applies the value itself). */
export function bindingVariants(lang: Lang): BindingVariant[] {
  const counts: Record<string, [number, number]> = {
    // [Python, JS]
    declaration: [2, 2],
    augmented: [1, 4],
    walrus: [1, 1],
    destructuring: [2, 6],
    'parameter-default': [1, 1],
    'import-as': [2, 2],
    // 0: the target and the read on the same receiver; 1: the target through an alias of the receiver's root
    // (`alias = box; alias.omit = V`), the read on the receiver itself (`Reflect.get(box, 'omit')`): only the
    // member's name links them (Codex, the commit that made one vocabulary and a literal subscript a dot).
    'member-target': [2, 2],
    chain: [1, 1],
    'string-key': [1, 1],
  };
  const out: BindingVariant[] = [];
  for (const { id } of BEST_EFFORT_BINDINGS) {
    const n = counts[id]?.[lang === 'python' ? 0 : 1] ?? 0;
    for (let v = 0; v < n; v++) out.push({ id, variant: v, member: id === 'member-target' });
  }
  out.push({ id: 'direct', variant: 0, member: false });
  return out;
}

/** One combination of the axes. */
export interface Combination {
  lang: Lang;
  binding: BindingVariant;
  member: Member;
  /** How the value reaches the member of the vocabulary. */
  access: AccessForm;
  use: Use;
  /** A member target's receiver, the access form it is assigned by, and the one the use reads it by. */
  receiver: Receiver | null;
  target: AccessForm | null;
  read: AccessForm | null;
}

/** Every combination of the axes, in order. */
export function* combinations(langs: readonly Lang[] = ['python', 'js']): Generator<Combination> {
  for (const lang of langs) {
    const forms = accessForms(lang);
    const recs = receivers(lang, MAX_CHAIN_STEPS);
    for (const binding of bindingVariants(lang)) {
      for (const member of members(lang)) {
        for (const access of forms) {
          for (const use of USES) {
            if (!binding.member) {
              yield { lang, binding, member, access, use, receiver: null, target: null, read: null };
              continue;
            }
            for (const receiver of recs) for (const target of forms) for (const read of forms) yield { lang, binding, member, access, use, receiver, target, read };
          }
        }
      }
    }
  }
}

// --- the exclusions: every combination that is not a case, and why ---------------------------------------

export interface Exclusion {
  id: string;
  reason: string;
  applies: (c: Combination) => boolean;
}

export const MATRIX_EXCLUSIONS: readonly Exclusion[] = [
  { id: 'js-uses', reason: 'JS/TS applies the vocabulary by a call: it has no decorator of a test function and no `raise`', applies: (c) => c.lang === 'js' && c.use !== 'call' },
  { id: 'walrus-js', reason: 'JS/TS has no walrus (`:=`): the form exists in Python only', applies: (c) => c.lang === 'js' && c.binding.id === 'walrus' },
  { id: 'exception-call', reason: 'calling an exception class constructs it and skips nothing; raising it does (RAISE_ONLY in the net)', applies: (c) => c.lang === 'python' && c.member.name in PY_UNITTEST_EXCEPTIONS && c.use === 'call' },
  { id: 'target-not-assignable', reason: 'an assignment target is a dot or a literal subscript: a by-name primitive is a call, not a target (a write through `setattr`/`Reflect.set` is documented coverage)', applies: (c) => c.target !== null && !c.target.assignable },
  { id: 'read-not-member', reason: '`hasattr`/`setattr`/`delattr`/`Reflect.has` return no member: never a read that is called or raised (their literal name still marks, as the value\'s access form)', applies: (c) => c.read !== null && !c.read.reads },
  { id: 'import-as-context', reason: 'an import under another name is a runner import\'s: the test context is not imported', applies: (c) => c.binding.id === 'import-as' && c.member.root.kind === 'context' },
  {
    id: 'import-as-member',
    reason: 'the second import under another name imports the member itself (`from pytest import skip as omit`, `import { xit as omit }`): it has no access form, and imports only a member of the module (not of `pytest.mark`, not a modifier of `it`)',
    applies: (c) => c.binding.id === 'import-as' && c.binding.variant === 1 && (c.access.id !== 'dot' || c.member.owner('R') !== 'R' || (c.lang === 'js' && c.member.root.id !== 'g')),
  },
  { id: 'import-as-namespace-js', reason: 'JS: `import { it as each }` renames the vitest import; the namespace root `g` is renamed by the second variant', applies: (c) => c.lang === 'js' && c.binding.id === 'import-as' && c.binding.variant === 0 && c.member.root.id !== 'it' },
  { id: 'destructuring-key', reason: 'JS: a destructuring by a member\'s key reads it by a dot (`{ skip: omit }`) or a literal key (`{ [\'skip\']: omit }`): it has no by-name form, and each variant is its own access form', applies: (c) => c.lang === 'js' && c.binding.id === 'destructuring' && ((c.binding.variant === 4 && c.access.id !== 'dot') || (c.binding.variant === 5 && c.access.id !== 'subscript')) },
  { id: 'string-key-dot', reason: 'a name that holds the member\'s name is used as a key or a by-name access\'s name: a dot has no name to hold', applies: (c) => c.binding.id === 'string-key' && c.access.id === 'dot' },
];

/** The one bound of an axis that is unbounded in what the net reads, and why. */
export const MATRIX_BOUNDS = [
  { id: 'chain-length', reason: `a receiver chain is checked with 1 to ${MAX_CHAIN_STEPS} steps: every step form at the first and at a later position, after every other; a longer chain repeats a step read the same way (memberChain is a loop over memberStep)` },
] as const;

/** The first exclusion that applies to a combination, or null: a case. */
/**
 * Where the matrix runs: `full`, every case (the `guarantee matrix (full)` CI job, in shards); `suite`, the normal
 * test suite, which leaves out two more slices of the product, each listed below with its reason.
 */
export type MatrixMode = 'full' | 'suite';

/** What the normal suite leaves out of the full matrix (the CI job runs it whole). */
export const SUITE_EXCLUSIONS: readonly Exclusion[] = [
  {
    id: 'suite-chain-length',
    reason: 'the suite checks a receiver bare or with 1 step: a chain of 2 steps is the same memberStep composed (memberChain is a loop over it), checked in the full matrix of the CI job',
    applies: (c) => c.receiver !== null && c.receiver.steps.length > 1,
  },
  {
    id: 'suite-member-target-value',
    reason: 'the suite reaches the vocabulary by a dot in a member target\'s value: every other access form of the value is checked by every other binding form in the suite, and with every receiver in the full matrix of the CI job',
    applies: (c) => c.receiver !== null && c.access.id !== 'dot',
  },
];

/** The first exclusion that applies to a combination in a mode, or null: a case. */
export function excludedBy(c: Combination, mode: MatrixMode = 'full'): Exclusion | null {
  return MATRIX_EXCLUSIONS.find((e) => e.applies(c)) ?? (mode === 'suite' ? SUITE_EXCLUSIONS.find((e) => e.applies(c)) ?? null : null);
}

// --- the cases ------------------------------------------------------------------------------------------

/** A case: the definition at base, a new use at head, and its control (the use replaced by a harmless call). */
export interface Case {
  title: string;
  path: string;
  base: string;
  head: string;
  control: string;
}

/** A binding of the value `V`: the definition's lines, the expression a use applies, and where they stand. */
interface Bound {
  definition: string[];
  name: string;
  /** The use stands inside the definition (a parameter default is bound in its function). */
  inside?: (use: string[]) => string[];
  /** Definition and use stand in a method (`self`, `this`). */
  method?: boolean;
  imports?: string;
}

const indent = (lines: string[], by: string): string[] => lines.map((l) => (l === '' ? l : `${by}${l}`));
const withControl = (c: Omit<Case, 'control'>, use: string, harmless: string): Case => ({ ...c, control: c.head.split(use).join(harmless) });

export function title(c: Combination): string {
  const rec = c.receiver ? ` × receiver ${c.receiver.text} × target ${c.target!.id} × read ${c.read!.id}` : '';
  return `${c.lang === 'js' ? 'JS' : 'Python'} ${c.binding.id}#${c.binding.variant} × ${c.member.name} ${c.member.root.id} × ${c.access.id}${rec} × ${c.use}`;
}

/** The value: the member of the vocabulary, reached by the combination's access form from the root's name. */
const value = (c: Combination, root = c.member.root.name): string => c.access.write(c.member.owner(root), c.member.name);
const omit = (c: Combination, form: AccessForm): string => form.write(c.receiver!.text, 'omit');
/** The receiver written from an alias of its root (`box` → `alias`, `this`/`self` → `alias`). */
const viaAlias = (c: Combination, form: AccessForm): string => form.write(c.receiver!.text.replace(/\b(?:box|this|self)\b/, 'alias'), 'omit');
const rootOf = (c: Combination): string => (c.receiver!.root === 'identifier' ? 'box' : c.lang === 'js' ? 'this' : 'self');

function pyBound(c: Combination): Bound {
  const v = value(c);
  const r = c.receiver;
  switch (`${c.binding.id}#${c.binding.variant}`) {
    case 'declaration#0': return { definition: [`omit = ${v}`], name: 'omit' };
    case 'declaration#1': return { definition: [`omit: object = ${v}`], name: 'omit' };
    case 'augmented#0': return { definition: ['omit = None', `omit += ${v}`], name: 'omit' };
    case 'walrus#0': return { definition: [`(omit := ${v})`], name: 'omit' };
    case 'destructuring#0': return { definition: [`(omit, other) = (${v}, 1)`], name: 'omit' };
    case 'destructuring#1': return { definition: [`[omit] = [${v}]`], name: 'omit' };
    case 'parameter-default#0': return { definition: [], name: 'omit', inside: (use) => [`def run(omit=${v}):`, ...indent(use.length > 0 ? use : ['pass'], '    ')] };
    case 'import-as#0': return { definition: [`omit = ${value(c, 'alias_root')}`], name: 'omit', imports: `import ${c.member.root.name} as alias_root` };
    case 'import-as#1': return { definition: [], name: 'omit', imports: `from ${c.member.root.name} import ${c.member.name} as omit` };
    case 'member-target#0': return { definition: [...(r!.root === 'identifier' ? ['box = Box()'] : []), `${omit(c, c.target!)} = ${v}`], name: omit(c, c.read!), method: r!.root === 'this-self' };
    case 'member-target#1': return { definition: [...(r!.root === 'identifier' ? ['box = Box()'] : []), `alias = ${rootOf(c)}`, `${viaAlias(c, c.target!)} = ${v}`], name: omit(c, c.read!), method: r!.root === 'this-self' };
    case 'chain#0': return { definition: [`first = ${v}`, 'omit = first'], name: 'omit' };
    case 'string-key#0': return { definition: [`k = "${c.member.name}"`, `omit = ${c.access.write(c.member.owner(c.member.root.name), c.member.name, 'k')}`], name: 'omit' };
    case 'direct#0': return { definition: [], name: v };
  }
  throw new Error(`no Python template for ${title(c)}`);
}

function jsBound(c: Combination): Bound {
  const v = value(c);
  const r = c.receiver;
  const op = ['+=', '||=', '??=', '&&='][c.binding.variant]!;
  switch (`${c.binding.id}#${c.binding.variant}`) {
    case 'declaration#0': return { definition: [`const omit = ${v};`], name: 'omit' };
    case 'declaration#1': return { definition: ['let omit;', `omit = ${v};`], name: 'omit' };
    case 'augmented#0': case 'augmented#1': case 'augmented#2': case 'augmented#3':
      return { definition: [`let omit${op === '&&=' ? ' = 1' : ''};`, `omit ${op} ${v};`], name: 'omit' };
    case 'destructuring#0': return { definition: [`const [omit] = [${v}];`], name: 'omit' };
    case 'destructuring#1': return { definition: [`const [omit = ${v}] = [];`], name: 'omit' };
    case 'destructuring#2': return { definition: [`const { omit = ${v} } = {};`], name: 'omit' };
    case 'destructuring#3': return { definition: [`const { a: omit } = { a: ${v} };`], name: 'omit' };
    case 'destructuring#4': return { definition: [`const { ${c.member.name}: omit } = ${c.member.root.name};`], name: 'omit' };
    case 'destructuring#5': return { definition: [`const { ['${c.member.name}']: omit } = ${c.member.root.name};`], name: 'omit' };
    case 'parameter-default#0': return { definition: [], name: 'omit', inside: (use) => [`const run = (omit = ${v}) => ${use.length === 0 ? '0' : use.join(' ').replace(/;$/, '')};`] };
    case 'import-as#0': return { definition: [`const omit = ${value(c, 'each')};`], name: 'omit', imports: "import { it as each, it } from 'vitest';" };
    case 'import-as#1': return { definition: [], name: 'omit', imports: `import { ${c.member.name} as omit } from '@jest/globals';\nimport { it } from 'vitest';` };
    case 'member-target#0': return { definition: [...(r!.root === 'identifier' ? ['const box: any = { a: { b: {} } };'] : []), `${omit(c, c.target!)} = ${v};`], name: omit(c, c.read!), method: r!.root === 'this-self' };
    case 'member-target#1': return { definition: [...(r!.root === 'identifier' ? ['const box: any = { a: { b: {} } };'] : []), `const alias: any = ${rootOf(c)};`, `${viaAlias(c, c.target!)} = ${v};`], name: omit(c, c.read!), method: r!.root === 'this-self' };
    case 'chain#0': return { definition: [`const first = ${v};`, 'const omit = first;'], name: 'omit' };
    case 'string-key#0': return { definition: [`const k = '${c.member.name}';`, `const omit = ${c.access.write(c.member.owner(c.member.root.name), c.member.name, 'k')};`], name: 'omit' };
    case 'direct#0': return { definition: [], name: v };
  }
  throw new Error(`no JS template for ${title(c)}`);
}

function pythonCase(c: Combination): Case {
  const b = pyBound(c);
  const use = c.use === 'call' ? `${b.name}("x")` : c.use === 'raise' ? `raise ${b.name}` : `@${b.name}`;
  const harmless = c.use === 'decorator' ? '@str' : 'str("x")';
  // A decorator applies to a definition: a nested one, where it does not decorate the test itself.
  const useLines = (u: string | null): string[] => (u === null ? [] : c.use === 'decorator' ? [u, 'def inner():', '    pass'] : [u]);
  const definition = (u: string | null): string[] => (b.inside ? b.inside(useLines(u)) : [...b.definition, ...useLines(u)]);
  const imports = [c.member.root.imports, ...(b.imports ? [b.imports] : [])].join('\n');
  const path = 'test_a.py';
  const t = title(c);
  if (c.member.root.kind === 'context' || b.method) {
    const cls = c.member.root.kind === 'context' ? 'class TestA(unittest.TestCase):' : 'class TestA:';
    const file = (u: string | null): string => [imports, '', '', 'class Box:', '    pass', '', '', cls, '    def test_a(self):', ...indent(definition(u), '        '), '        assert True', ''].join('\n');
    return withControl({ title: t, path, base: file(null), head: file(use) }, use, harmless);
  }
  const top = (u: string | null): string => `${imports}\n\n\nclass Box:\n    pass\n\n\n${definition(u).join('\n')}\n\n\n`;
  const test = (decorated: boolean, body: string[]): string => `${decorated ? `${use}\n` : ''}def test_a():\n${[...body, 'assert True'].map((l) => `    ${l}`).join('\n')}\n`;
  if (b.inside) return withControl({ title: t, path, base: top(null) + test(false, []), head: top(use) + test(false, []) }, use, harmless);
  if (c.use === 'decorator') return withControl({ title: t, path, base: top(null) + test(false, []), head: top(null) + test(true, []) }, `${use}\n`, `${harmless}\n`);
  return withControl({ title: t, path, base: top(null) + test(false, []), head: top(null) + test(false, [use]) }, use, harmless);
}

function jsCase(c: Combination): Case {
  const b = jsBound(c);
  const imports = b.imports ?? c.member.root.imports;
  const t = title(c);
  const path = 'test/a.test.ts';
  const definition = (u: string | null): string[] => (b.inside ? b.inside(u === null ? [] : [u]) : b.definition);
  // A receiver `this` stands in a method of an object literal (Codex's reproduction): around the definition and the use.
  const inMethod = (lines: string[]): string[] => (b.method ? ['const holder = { a: { b: {} } as any, run() {', ...indent(lines, '  '), '} };', 'holder.run();'] : lines);
  if (c.member.root.wrap) {
    const wrap = c.member.root.wrap;
    const body = (use: string | null): string => wrap(indent(inMethod([...definition(use), ...(use && !b.inside ? [use] : [])]), '  ').join('\n'));
    return withControl({ title: t, path, base: `${imports}\n\n${body(null)}\n`, head: `${imports}\n\n${body(`${b.name}();`)}\n` }, `${b.name}();`, "String('b');");
  }
  // The use declares test 'b' through the alias in place of a plain `it('b', …)` at base: a test that existed (a
  // disabling marker on a test that did not exist at base is an INFO line since the noise round, docs/rules.md
  // TG003). The control keeps the plain declaration.
  const plain = "it('b', () => {});";
  if (b.inside) {
    const call = `${b.name}('b', () => {});`;
    return withControl({ title: t, path, base: `${imports}\n${definition(plain).join('\n')}\n\nit('a', () => {});\n`, head: `${imports}\n${definition(call).join('\n')}\n\nit('a', () => {});\n` }, call.replace(/;$/, ''), plain.replace(/;$/, ''));
  }
  const call = `${b.name}('b', () => {});`;
  const file = (use: string | null): string => `${imports}\n${inMethod([...definition(use), ...(use ? [use] : [])]).join('\n')}\n\nit('a', () => {});\n`;
  return withControl({ title: t, path, base: file(plain), head: file(call) }, call, plain);
}

/** The case of a combination that no exclusion applies to. */
export function caseOf(c: Combination): Case {
  return c.lang === 'python' ? pythonCase(c) : jsCase(c);
}

// --- the analysis, in batches ---------------------------------------------------------------------------

export type Severity = 'OK' | 'INFO' | 'WARN' | 'FAIL';

/** What a file's findings came to: the highest severity, and what the findings above INFO said. */
export interface FileResult {
  severity: Severity;
  said: string[];
}

/** The pipeline's entry point (src/check.ts, `analyze`), passed in so that a script can run another revision's. */
export type Analyze = (input: {
  base: string;
  head: string;
  changes: Array<{ status: 'M'; basePath: string; headPath: string }>;
  read: (side: 'base' | 'head', path: string) => string | null;
}) => Promise<{ findings: ReadonlyArray<{ file: string; severity: string; rule: string; message: string }> }>;

/**
 * Files per `analyze` (one Python interpreter each): a batch of 400 reads in ≈ 0.15 s of Python here, against the
 * scope reader's limits (60 s for a call of up to 1 MB, then 300 s; src/parse/py-scopes.ts).
 */
export const BATCH = 400;

const RANK: Record<Severity, number> = { OK: 0, INFO: 1, WARN: 2, FAIL: 3 };

/** Every file analysed through the whole pipeline, in batches of one change each (what a real run does). */
export async function analyseFiles(analyze: Analyze, files: ReadonlyArray<{ path: string; base: string; head: string }>): Promise<Map<string, FileResult>> {
  const out = new Map<string, FileResult>(files.map((f) => [f.path, { severity: 'OK', said: [] }]));
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const sides = { base: new Map(batch.map((f) => [f.path, f.base])), head: new Map(batch.map((f) => [f.path, f.head])) };
    const report = await analyze({
      base: '0'.repeat(40),
      head: '1'.repeat(40),
      changes: batch.map((f) => ({ status: 'M' as const, basePath: f.path, headPath: f.path })),
      read: (side, p) => sides[side].get(p) ?? null,
    });
    for (const f of report.findings) {
      const r = out.get(f.file);
      if (!r) continue;
      const s = f.severity.toUpperCase() as Severity;
      if (RANK[s] > RANK[r.severity]) r.severity = s;
      if (RANK[s] >= RANK.WARN) r.said.push(`${f.rule} ${f.severity}: ${f.message}`);
    }
  }
  return out;
}

/** A case and its control placed under their own directories: one batch reads them as files of one change. */
export interface Placed {
  title: string;
  c: Case;
  at: string;
  control: string;
}

/** The cases of a mode, in order, placed (`shard`/`shards`: every `shards`-th case from the `shard`-th). */
export function* placedCases(mode: MatrixMode, shard = 0, shards = 1): Generator<Placed> {
  let i = -1;
  for (const comb of combinations()) {
    if (excludedBy(comb, mode)) continue;
    i++;
    if (i % shards !== shard) continue;
    const c = caseOf(comb);
    yield { title: c.title, c, at: `case${i}/${c.path}`, control: `control${i}/${c.path}` };
  }
}

/** Whether a case holds: its use at least a WARN, its control nothing above INFO. */
export function holds(r: { use: FileResult; control: FileResult }): boolean {
  return RANK[r.use.severity] >= RANK.WARN && RANK[r.control.severity] <= RANK.INFO;
}

// --- the shards of the CI job, failing closed -----------------------------------------------------------

/** The cases of a mode, counted without building or analysing any (what the shards must add up to). */
export function countCases(mode: MatrixMode): number {
  let n = 0;
  for (const c of combinations()) if (!excludedBy(c, mode)) n++;
  return n;
}

/** What a shard of the CI job reports (scripts/guarantee-matrix.ts --report). */
export interface ShardReport {
  mode: MatrixMode;
  shard: number;
  shards: number;
  cases: number;
  failures: number;
}

/**
 * Why a set of shard reports does not show the whole matrix run and holding — empty when it does. Fails closed: every
 * shard 0…shards−1 reported exactly once, in the mode, each with at least one case and none failing, and the cases
 * adding up to the total the generator counts.
 */
export function verifyShards(reports: readonly ShardReport[], expected: { mode: MatrixMode; shards: number; total: number }): string[] {
  const problems: string[] = [];
  const seen = new Map<number, number>();
  for (const r of reports) {
    if (r.mode !== expected.mode || r.shards !== expected.shards) problems.push(`shard ${r.shard}: reported ${r.mode} ${r.shard}/${r.shards}, expected ${expected.mode} of ${expected.shards}`);
    seen.set(r.shard, (seen.get(r.shard) ?? 0) + 1);
    if (!(Number.isInteger(r.cases) && r.cases > 0)) problems.push(`shard ${r.shard}: ran ${r.cases} cases`);
    if (r.failures !== 0) problems.push(`shard ${r.shard}: ${r.failures} cases failing`);
  }
  for (let s = 0; s < expected.shards; s++) {
    const n = seen.get(s) ?? 0;
    if (n !== 1) problems.push(`shard ${s}: reported ${n} times`);
  }
  for (const s of seen.keys()) if (!(Number.isInteger(s) && s >= 0 && s < expected.shards)) problems.push(`shard ${s}: not one of 0…${expected.shards - 1}`);
  const sum = reports.reduce((a, r) => a + r.cases, 0);
  if (sum !== expected.total) problems.push(`the shards ran ${sum} cases, the matrix has ${expected.total}`);
  return problems;
}
