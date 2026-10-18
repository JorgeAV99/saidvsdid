// The contagion net: a new use of the skip/focus vocabulary through a name or a member that holds it is at least a
// WARN (docs/rules.md, *Safety nets*). It reads every form below, best effort, with no guarantee: the guarantee is
// only the direct forms and the simple alias of src/rules/guarantee.ts (docs/rules.md, *The silence guarantee*);
// what the net catches beyond them is *Best-effort detection*, protected against regressions by the matrix
// (test/guarantee-matrix.ts, its suite slice in test/silence-guarantee.test.ts).
//
// The extractor (src/parse) reads the vocabulary precisely and words the findings; this net stands behind it,
// and it reads tokens, not meanings — never a position. In each changed test file,
// on both sides, after normalisation (NFKC and mangling for Python, escapes decoded, parentheses and type
// assertions read away: src/parse/normalise.ts; TypeScript's types hold nothing):
//
// - Tokens: the names of the vocabulary's members and functions (`skip`, `only`, `todo`, `fails`,
//   `skipIf`, `runIf`, `skipif`, `xfail`, `SkipTest`, `skipTest`, `fit`, `xit`, `xdescribe`…, as
//   imported from the runner packages too), read as whole identifiers — never a substring
//   (`skip_reason`, `onlyOnce` are not tokens) — and a string of the vocabulary: a string literal
//   exactly equal to a token, or one whose value is not certain.
// - Marked names, to a fixed point within the file, whatever the scope. A statement that binds names
//   (an assignment of any operator, a declaration, a class field, a default, a destructuring, a walrus,
//   `for`, `with`/`except … as`, an import, a decorated definition, a match capture) binds every
//   name of its target — a member target binds every name of its receiver chain, a literal subscript
//   the same member as a dot (`self.omit = …` binds `self` and `omit`, `this['omit'] = …` binds `this`
//   and `omit`, `d['k'] = …` binds `d` and `k`: src/parse/normalise.ts, `memberChain`). They are marked when its value or its pattern holds a token or a
//   marked name (the body of a function it defines counts as its value), and they hold a string when
//   the value holds a string of the vocabulary, directly or in any container, or a name that holds one
//   — read outside the functions it defines: a function is not a container, what it returns is
//   computed at run time.
// - Where the code names something — an identifier, `this`, a member however written: a dot, a literal
//   subscript, a by-name primitive that returns it with a literal name (`it['skip']` is `it.skip`,
//   `this['omit']` is `this.omit`, `Reflect.get(box, 'omit')` is `box.omit`, `getattr(self, "stop")` is
//   `self.stop`: one reader, `memberStep` in src/parse/normalise.ts) — the name is read as a token and looked
//   up among the marked names and the names that hold a string.
// - A use is a call, a decorator or a raise whose callee — the expression before the final argument
//   list, its subscripts and keys included — holds a token, a string of the vocabulary, a marked name
//   or a name that holds a string: `omit()`, `Actions.omit()`, `pt.skip(…)`, `it[key](…)`,
//   `ctx[keys[0]]()`, `getattr(pytest, k)(…)`, `Reflect['get'](ctx, 'skip')()`, `@later`, `raise stop`.
//   Each new use at head (one base did not have, by callee, form and test) is at least a WARN naming
//   its test, unless a finding of the extractor already stands on it.
// - A normal call is an opaque frontier, on both sides: what enters it as an argument counts neither in
//   a value (`r = f(GOOD)` holds nothing) nor in a callee (`expect(statusOf(kind)).toBe(…)`,
//   `it.each([['skip']])(…)` are not uses; `procesar(kind)` neither). Its callee always counts
//   (`pytest.mark.skip(reason=…)`, `t.skip.bind(t)`, `unittest.SkipTest("x")`). Only the by-name access
//   primitives are transparent — getattr/hasattr/setattr/delattr, Reflect.get/Reflect.has (with a dot or
//   a literal subscript) — as subscripts and computed keys are.
//
// Outside the matrix, read best effort (src/rules/guarantee.ts, OUTSIDE_THE_MATRIX): class fields and
// enum members (read best effort when their name is literal), values that enter a function (`run(omit)`, `wrap(it.skip)`,
// `r = f(GOOD)`), a name built at run time (`'sk' + 'ip'`, a template or an f-string with a
// substitution, what a function returns), a call's result called at once (`make()()`), a function
// declared with `def`/`function` (its calls are not uses), a module imported from another file.
import type { Node } from 'web-tree-sitter';
import { getParser, languageForPath } from '../parse/loader.js';
import { jsMember, jsName, jsString, memberChain, memberStep, pyName, pyString, unwrap } from '../parse/normalise.js';
import { JS_TOKENS, PY_TOKENS as PY_VOCABULARY_TOKENS, PY_UNITTEST_EXCEPTIONS } from '../parse/vocabulary.js';
import { BY_NAME_PRIMITIVES } from './guarantee.js';
import { mangle, manglingClass } from '../parse/py-binding.js';
import type { MarkerKind, TestCase } from '../parse/types.js';
import type { Finding, RuleId } from './types.js';
import { MAY, NEW_TEST } from './util.js';
import { nameTable } from '../util/names.js';

/** The tokens of the vocabulary, and the kind of marker each names: every member of src/parse/vocabulary.ts. */
export const TS_TOKENS: Readonly<Record<string, MarkerKind>> = JS_TOKENS;
export const PY_TOKENS: Readonly<Record<string, MarkerKind>> = PY_VOCABULARY_TOKENS;

/** The kind a token names, by the table's own keys only (`toString`, `constructor` are not tokens). */
function tokenKind(tokens: Readonly<Record<string, MarkerKind>>, name: string): MarkerKind | undefined {
  return Object.hasOwn(tokens, name) ? tokens[name] : undefined;
}

/** Tokens that name an exception class: they do nothing until raised, so a call of them is not a use (a raise and a binding are). */
const RAISE_ONLY: ReadonlySet<string> = new Set(Object.keys(PY_UNITTEST_EXCEPTIONS));

type Lang = 'python' | 'js';

/** Why a name or a callee bears the vocabulary: the token or the string, or the name and where it is bound. */
interface Mark {
  kinds: Set<MarkerKind>;
  /** The token, or the string literal as written. */
  token: string;
  /** null: an identifier; 'token': a string equal to a token; 'uncertain': a string whose value is not certain. */
  string: 'token' | 'uncertain' | null;
  /** The name the callee holds, its binding line, and the name that binding holds (an alias of an alias). */
  via: { name: string; line: number; through: string | null } | null;
}

interface Binding {
  /** The names it binds, as the language reads them where they stand. */
  names: string[];
  scan: Node[];
  line: number;
}

/** One use of the vocabulary: a call, a decorator or a raise whose callee bears it. */
export interface ContagionUse {
  form: 'call' | 'decorator' | 'raise';
  callee: string;
  line: number;
  /** The last line of the callee: a finding of the extractor between `line` and here stands on the use. */
  calleeEnd: number;
  test: string | null;
  mark: Mark;
}

/** What names something in JS/TS: an identifier, a property's name, and `this` (a receiver, as `self` is in Python). */
const JS_IDS = new Set(['identifier', 'property_identifier', 'private_property_identifier', 'shorthand_property_identifier', 'shorthand_property_identifier_pattern', 'this']);
/**
 * TypeScript's types hold nothing at run time (`kind?: 'skip'`, `as typeof it.skip`, `<'skip'>x`), as the
 * normalisation reads them away: a token or a string in a type marks nothing.
 */
const TS_TYPES = new Set(['type_annotation', 'type_arguments', 'type_parameters', 'type_alias_declaration', 'interface_declaration', 'literal_type', 'type_query', 'opting_type_annotation', 'omitting_type_annotation', 'adding_type_annotation', 'asserts_annotation', 'type_predicate_annotation', 'implements_clause']);
const PY_IDS = new Set(['identifier', 'keyword_identifier']);
/** The functions a value may define: what their bodies (and defaults) hold is computed when they run, not held by the value. */
const FUNCTIONS = new Set(['lambda', 'function_definition', 'arrow_function', 'function_expression', 'function', 'function_declaration', 'generator_function', 'generator_function_declaration', 'method_definition']);

/** Python's functions that read a member by name (`getattr(obj, name)`): their arguments are a member access (src/rules/guarantee.ts). */
const PY_BY_NAME: ReadonlySet<string> = new Set(BY_NAME_PRIMITIVES.python.map((p) => p.name));
/** `Reflect`'s functions that read a member by name (`Reflect.get(obj, name)`, `Reflect['get'](…)`; src/rules/guarantee.ts). */
const JS_BY_NAME: ReadonlySet<string> = new Set(BY_NAME_PRIMITIVES.js.members.map((p) => p.name));

/**
 * A call is an opaque frontier: what enters it as an argument is not part of the value or the callee that holds
 * the call. Only the by-name access primitives are transparent — getattr/hasattr/setattr/delattr and
 * Reflect.get/Reflect.has (written with a dot or a literal subscript, after normalisation) — as subscripts and
 * computed keys are: they read a member by name. Their callee always counts (`pytest.mark.skip(reason=…)`,
 * `t.skip.bind(t)`, `unittest.SkipTest("x")`).
 */
function opaqueArgs(call: Node, lang: Lang): Node | null {
  if (lang === 'python') {
    if (call.type !== 'call') return null;
    const fn = call.childForFieldName('function');
    const f = fn ? unwrap(fn) : null;
    if (f && f.type === 'identifier' && PY_BY_NAME.has(pyName(f))) return null;
    return call.childForFieldName('arguments');
  }
  if (call.type === 'new_expression') return call.childForFieldName('arguments');
  if (call.type !== 'call_expression') return null;
  const fn = call.childForFieldName('function');
  const m = fn ? jsMember(fn) : null;
  if (m && JS_BY_NAME.has(m.name)) {
    const object = unwrap(m.object);
    if (object.type === 'identifier' && jsName(object) === BY_NAME_PRIMITIVES.js.object) return null;
  }
  return call.childForFieldName('arguments');
}

/** A name as the language reads it where it stands (Python: NFKC and mangled in a class body; JS: escapes decoded). */
function nameAt(id: Node, lang: Lang): string {
  return lang === 'python' ? mangle(pyName(id), manglingClass(id)) : jsName(id);
}

/** A string whose value is not certain (an escape only some code reads): it may be any token. */
const UNCERTAIN = Symbol('uncertain');

/** A string literal as a token reads it: its value, UNCERTAIN (an escape whose value is not certain), or null (computed at run time). */
function stringToken(n: Node, lang: Lang): string | typeof UNCERTAIN | null {
  if (lang === 'python') {
    if (n.type === 'string' && n.parent?.type === 'concatenated_string') return null; // read once, joined
    if (n.type !== 'string' && n.type !== 'concatenated_string') return null;
    const parts = n.type === 'string' ? [n] : n.namedChildren;
    if (parts.some((p) => p.namedChildren.some((c) => c.type === 'interpolation') || /^[a-z]*b/i.test(p.namedChildren.find((c) => c.type === 'string_start')?.text ?? ''))) return null;
    return pyString(n) ?? UNCERTAIN;
  }
  if (n.type === 'template_string' && n.namedChildren.some((c) => c.type === 'template_substitution')) return null;
  if (n.type !== 'string' && n.type !== 'template_string') return null;
  return jsString(n) ?? UNCERTAIN;
}

/**
 * What a scan of a subtree reads:
 * - 'value': tokens and marked names, the bodies of the functions it defines included (what may be the vocabulary);
 * - 'string': strings of the vocabulary and names that hold one, outside the functions it defines (what may name it);
 * - 'callee': all of them, everywhere (a use).
 */
type Scan = 'value' | 'string' | 'callee';

/** The names marked by the file's bindings, and the names that hold a string of the vocabulary. */
interface Marks {
  marked: ReadonlyMap<string, Mark>;
  held: ReadonlyMap<string, Mark>;
  /**
   * Every name the file binds itself, whatever the value (a variable, a parameter, a function, an import): a bare
   * identifier spelled like a token is the vocabulary only when the file does not bind it, as a runner's global
   * (`fit`, `xit`), or binds it to something that bears the vocabulary (an import from a runner, an alias) — never
   * by the name of any variable (`for (const fail of …)`).
   */
  bound: ReadonlySet<string>;
  /** JS: names bound to an assertion library's import or require (`assert` from node:assert, chai's `assert`/`expect`): their members are assertions (`assert.fail`). */
  assertion: ReadonlySet<string>;
}

/**
 * Assertion libraries, by module specifier: what their imports bind asserts (`assert.fail(…)` fails the test), it does
 * not mark it (the runner's `test.fail`). A closed list.
 */
const ASSERTION_MODULES: ReadonlySet<string> = new Set(['assert', 'node:assert', 'assert/strict', 'node:assert/strict', 'chai', 'power-assert', 'uvu/assert', 'should', 'expect', '@std/assert']);

/** Whether `id`, an identifier where the code names something, is a bare name (a variable's, a global's), not a member's, a key's or an imported export's. */
function isBare(id: Node, lang: Lang): boolean {
  const p = id.parent;
  if (lang === 'js') {
    if (id.type !== 'identifier') return id.type === 'shorthand_property_identifier';
    return !(p?.type === 'import_specifier' && p.childForFieldName('name')?.id === id.id);
  }
  if (id.type !== 'identifier' && id.type !== 'keyword_identifier') return false;
  if (p?.type === 'dotted_name') return false;
  return !(p?.type === 'attribute' && p.childForFieldName('attribute')?.id === id.id);
}

/** Every name a JS/TS pattern declares (`a`, `[a, ...b]`, `{ c, d: e }`, `f = 1`); a member target declares nothing. */
function jsDeclared(p: Node | null, out: Set<string>): void {
  if (!p) return;
  const n = unwrap(p);
  if (n.type === 'identifier' || n.type === 'shorthand_property_identifier_pattern') out.add(nameAt(n, 'js'));
  else if (n.type === 'pair_pattern') jsDeclared(n.childForFieldName('value'), out);
  else if (n.type === 'assignment_pattern' || n.type === 'object_assignment_pattern' || n.type === 'required_parameter' || n.type === 'optional_parameter') jsDeclared(n.childForFieldName('left') ?? n.childForFieldName('pattern'), out);
  else if (['array_pattern', 'object_pattern', 'rest_pattern', 'formal_parameters'].includes(n.type)) for (const c of n.namedChildren) jsDeclared(c, out);
}

/** Every name a Python target declares (`a`, `(a, *b)`, `[a]`); an attribute or a subscript declares nothing. */
function pyDeclared(t: Node | null, out: Set<string>): void {
  if (!t) return;
  if (t.type === 'identifier') out.add(nameAt(t, 'python'));
  else if (['pattern_list', 'tuple_pattern', 'list_pattern', 'tuple', 'list', 'list_splat_pattern', 'dictionary_splat_pattern', 'parenthesized_expression', 'expression_list', 'as_pattern_target', 'typed_parameter', 'parameters', 'lambda_parameters', 'case_pattern', 'splat_pattern'].includes(t.type)) {
    for (const c of t.namedChildren) pyDeclared(c, out);
  } else if (t.type === 'default_parameter' || t.type === 'typed_default_parameter') pyDeclared(t.childForFieldName('name'), out);
}

/** The names the file binds itself, whatever their value (see Marks.bound). */
function boundNames(root: Node, lang: Lang): Set<string> {
  const out = new Set<string>();
  if (lang === 'js') {
    for (const n of root.descendantsOfType(['variable_declarator', 'formal_parameters', 'arrow_function', 'catch_clause', 'function_declaration', 'generator_function_declaration', 'function_expression', 'class_declaration', 'class', 'for_in_statement', 'import_specifier', 'import_clause', 'namespace_import', 'assignment_expression'])) {
      switch (n.type) {
        case 'variable_declarator':
          jsDeclared(n.childForFieldName('name'), out);
          break;
        case 'formal_parameters':
          jsDeclared(n, out);
          break;
        case 'arrow_function':
          jsDeclared(n.childForFieldName('parameter'), out);
          break;
        case 'catch_clause':
          jsDeclared(n.childForFieldName('parameter'), out);
          break;
        case 'for_in_statement':
        case 'assignment_expression':
          jsDeclared(n.childForFieldName('left'), out);
          break;
        case 'import_specifier':
          jsDeclared(n.childForFieldName('alias') ?? n.childForFieldName('name'), out);
          break;
        case 'import_clause':
        case 'namespace_import':
          for (const c of n.namedChildren) if (c.type === 'identifier') out.add(nameAt(c, 'js'));
          break;
        default:
          jsDeclared(n.childForFieldName('name'), out);
      }
    }
    return out;
  }
  for (const n of root.descendantsOfType(['assignment', 'augmented_assignment', 'for_statement', 'for_in_clause', 'named_expression', 'function_definition', 'class_definition', 'lambda', 'as_pattern', 'import_statement', 'import_from_statement', 'except_clause'])) {
    switch (n.type) {
      case 'assignment':
      case 'augmented_assignment':
      case 'for_statement':
      case 'for_in_clause':
        pyDeclared(n.childForFieldName('left'), out);
        break;
      case 'named_expression':
        pyDeclared(n.childForFieldName('name'), out);
        break;
      case 'function_definition':
        pyDeclared(n.childForFieldName('name'), out);
        pyDeclared(n.childForFieldName('parameters'), out);
        break;
      case 'lambda':
        pyDeclared(n.childForFieldName('parameters'), out);
        break;
      case 'class_definition':
        pyDeclared(n.childForFieldName('name'), out);
        break;
      case 'as_pattern':
        pyDeclared(n.childForFieldName('alias') ?? n.namedChildren.find((c) => c.type === 'as_pattern_target') ?? null, out);
        break;
      case 'except_clause':
        for (const c of n.namedChildren) if (c.type === 'as_pattern') pyDeclared(c.childForFieldName('alias'), out);
        break;
      default:
        for (const name of n.childrenForFieldName('name')) {
          if (name.type === 'aliased_import') pyDeclared(name.childForFieldName('alias'), out);
          else if (name.type === 'dotted_name') {
            const id = n.type === 'import_statement' ? name.namedChildren[0] : name.namedChildren.at(-1);
            if (id?.type === 'identifier') out.add(nameAt(id, 'python'));
          }
        }
    }
  }
  return out;
}

/** JS: the names the file binds to an assertion library's import or require (Marks.assertion). */
function assertionNames(root: Node): Set<string> {
  const out = new Set<string>();
  const fromAssertion = (s: Node | null | undefined): boolean => {
    const v = s ? jsString(s) : null;
    return v !== null && ASSERTION_MODULES.has(v);
  };
  for (const n of root.descendantsOfType('import_statement')) {
    if (!fromAssertion(n.childForFieldName('source'))) continue;
    for (const c of n.descendantsOfType(['import_clause', 'namespace_import', 'import_specifier'])) {
      if (c.type === 'import_specifier') jsDeclared(c.childForFieldName('alias') ?? c.childForFieldName('name'), out);
      else for (const id of c.namedChildren) if (id.type === 'identifier') out.add(nameAt(id, 'js'));
    }
  }
  for (const d of root.descendantsOfType('variable_declarator')) {
    let v = d.childForFieldName('value');
    v = v ? unwrap(v) : null;
    while (v && v.type === 'member_expression') v = unwrap(v.childForFieldName('object')!);
    if (v?.type !== 'call_expression') continue;
    const fn = v.childForFieldName('function');
    if (fn?.type !== 'identifier' || jsName(fn) !== 'require') continue;
    if (fromAssertion(v.childForFieldName('arguments')?.namedChildren[0])) jsDeclared(d.childForFieldName('name'), out);
  }
  return out;
}

/** What in a subtree bears the vocabulary, as `scan` reads it: the first token, string or name found, with every kind found. */
function bears(root: Node, lang: Lang, tokens: Readonly<Record<string, MarkerKind>>, marks: Marks, scan: Scan): Mark | null {
  const ids = lang === 'python' ? PY_IDS : JS_IDS;
  const names = scan === 'string' ? [marks.held] : scan === 'value' ? [marks.marked] : [marks.marked, marks.held];
  let first: Mark | null = null;
  const kinds = new Set<MarkerKind>();
  /**
   * A name where the code names something (an identifier, a member): a token, or a marked or held name. A bare
   * name the file binds itself is a token only when that binding bears the vocabulary (Marks.bound).
   */
  const readName = (name: string, bare = false): void => {
    const own = bare && marks.bound.has(name) && !marks.marked.has(name);
    const kind = scan === 'string' || own ? undefined : tokenKind(tokens, name);
    if (kind) {
      kinds.add(kind);
      first ??= { kinds, token: name, string: null, via: null };
    }
    for (const map of names) {
      const m = map.get(name);
      if (!m) continue;
      for (const k of m.kinds) kinds.add(k);
      first ??= { kinds, token: m.token, string: m.string, via: { name, line: m.via?.line ?? 0, through: m.via?.through ?? null } };
    }
  };
  const visit = (n: Node): void => {
    if (lang === 'js' && TS_TYPES.has(n.type)) return;
    const args = opaqueArgs(n, lang);
    if (args) {
      // A call's callee counts; what enters it as an argument does not.
      for (const c of n.namedChildren) if (c.id !== args.id) visit(c);
      return;
    }
    if (scan === 'string' && FUNCTIONS.has(n.type)) return;
    if (lang === 'js' && (n.type === 'as_expression' || n.type === 'satisfies_expression')) {
      // `x as T`, `x satisfies T`: the expression, not its type.
      const expr = n.namedChildren.find((c) => c.type !== 'comment');
      if (expr) visit(expr);
      return;
    }
    // A literal subscript or a by-name primitive returning the member names it as a dot does (`this['omit']`,
    // `Reflect.get(box, 'omit')`, `getattr(self, "omit")` are `this.omit`, `box.omit`, `self.omit`: one reader,
    // src/parse/normalise.ts, `memberStep`); the literal is a string too, read below.
    // A member of an assertion library's import asserts (`assert.fail(…)`, chai's `expect.fail(…)`): not the vocabulary.
    if (lang === 'js' && marks.assertion.size > 0 && (n.type === 'member_expression' || n.type === 'subscript_expression')) {
      const root = memberChain(n, 'js')?.[0];
      if (root && root.node.type === 'identifier' && marks.assertion.has(root.name)) return;
    }
    if (n.type === 'subscript_expression' || n.type === 'subscript' || n.type === 'call_expression' || n.type === 'call') {
      const step = memberStep(n, lang);
      if (step?.literal) readName(step.name);
    }
    if (ids.has(n.type)) {
      readName(nameAt(n, lang), isBare(n, lang));
    } else {
      const s = stringToken(n, lang);
      if (s !== null) {
        const kind = s === UNCERTAIN ? 'skip' : tokenKind(tokens, s);
        if (kind && scan !== 'value') {
          kinds.add(kind);
          first ??= { kinds, token: n.text, string: s === UNCERTAIN ? 'uncertain' : 'token', via: null };
        }
        if (n.type !== 'concatenated_string') return;
      }
    }
    for (const c of n.namedChildren) visit(c);
  };
  visit(root);
  return first;
}

// --- bindings ------------------------------------------------------------------------------------

/**
 * The names a member target binds (`self.omit`, `this['omit']`, `this.a['b']`, `d['k']`): every name of its
 * receiver chain, root and members, a literal subscript the same member as a dot (src/parse/normalise.ts,
 * `memberChain`). A receiver outside the chain (a call, a subscript computed at run time: coverage) binds
 * every identifier of the target, best effort.
 */
function memberTarget(t: Node, lang: Lang, out: string[]): void {
  const chain = memberChain(t, lang);
  if (chain) {
    for (const c of chain) out.push(c.literal ? c.name : nameAt(c.node, lang));
    return;
  }
  const ids = lang === 'python' ? PY_IDS : JS_IDS;
  const all = (n: Node): void => {
    if (ids.has(n.type)) out.push(nameAt(n, lang));
    else for (const c of n.namedChildren) all(c);
  };
  all(t);
}

/** Names a Python target binds (`a`, `(a, *b)`, `[a]`, and every name of `self.omit` or `d['k']`). */
function pyTargets(t: Node | null, out: string[]): void {
  if (!t) return;
  if (t.type === 'identifier') out.push(nameAt(t, 'python'));
  else if (t.type === 'attribute' || t.type === 'subscript') memberTarget(t, 'python', out);
  else if (['pattern_list', 'tuple_pattern', 'list_pattern', 'tuple', 'list', 'list_splat_pattern', 'parenthesized_expression', 'expression_list', 'as_pattern_target', 'case_pattern', 'splat_pattern', 'dotted_name', 'dict_pattern', 'class_pattern', 'keyword_pattern', 'union_pattern', 'as_pattern'].includes(t.type)) {
    for (const c of t.namedChildren) pyTargets(c, out);
  }
}

function pythonBindings(root: Node): Binding[] {
  const out: Binding[] = [];
  const add = (target: Node | null, scan: Array<Node | null>, at: Node): void => {
    const names: string[] = [];
    pyTargets(target, names);
    const s = scan.filter((x): x is Node => x !== null);
    if (names.length > 0 && s.length > 0) out.push({ names, scan: s, line: at.startPosition.row + 1 });
  };
  for (const n of root.descendantsOfType(['assignment', 'augmented_assignment', 'named_expression', 'for_statement', 'for_in_clause', 'as_pattern', 'default_parameter', 'typed_default_parameter', 'import_statement', 'import_from_statement', 'decorated_definition', 'type_alias_statement', 'case_clause'])) {
    switch (n.type) {
      case 'assignment':
      case 'augmented_assignment':
      case 'for_statement':
      case 'for_in_clause':
        add(n.childForFieldName('left'), [n.childForFieldName('right')], n);
        break;
      case 'named_expression':
        add(n.childForFieldName('name'), [n.childForFieldName('value')], n);
        break;
      case 'as_pattern':
        add(n.childForFieldName('alias') ?? n.namedChildren.find((c) => c.type === 'as_pattern_target') ?? null, [n.namedChildren[0] ?? null], n);
        break;
      case 'default_parameter':
      case 'typed_default_parameter':
        add(n.childForFieldName('name'), [n.childForFieldName('value')], n);
        break;
      case 'import_statement':
      case 'import_from_statement':
        for (const name of n.childrenForFieldName('name')) {
          if (name.type === 'aliased_import') add(name.childForFieldName('alias'), [name.childForFieldName('name')], n);
          else if (name.type === 'dotted_name') add(n.type === 'import_statement' ? name.namedChildren[0] ?? null : name.namedChildren.at(-1) ?? null, [name], n);
        }
        break;
      case 'decorated_definition': {
        const def = n.childForFieldName('definition');
        add(def?.childForFieldName('name') ?? null, n.namedChildren.filter((c) => c.type === 'decorator'), n);
        break;
      }
      case 'type_alias_statement':
        add(n.namedChildren[0] ?? null, [n.namedChildren.at(-1) ?? null], n);
        break;
      case 'case_clause': {
        // A match capture: every name a case pattern may bind holds the subject.
        let m: Node | null = n.parent;
        while (m && m.type !== 'match_statement') m = m.parent;
        const subject = m?.childForFieldName('subject') ?? null;
        for (const p of n.namedChildren.filter((c) => c.type === 'case_pattern')) add(p, [subject], n);
        break;
      }
    }
  }
  return out;
}

/** Names a JS/TS pattern binds (`a`, `[a, ...b]`, `{ c, d: e }`, `f = 1`, and every name of `this.omit` or `d['k']`). */
function jsTargets(p: Node | null, out: string[]): void {
  if (!p) return;
  const n = unwrap(p);
  if (n.type === 'identifier' || n.type === 'shorthand_property_identifier_pattern') out.push(nameAt(n, 'js'));
  else if (n.type === 'member_expression' || n.type === 'subscript_expression') memberTarget(n, 'js', out);
  else if (n.type === 'pair_pattern' || n.type === 'pair') jsTargets(n.childForFieldName('value'), out);
  else if (n.type === 'assignment_pattern' || n.type === 'object_assignment_pattern') jsTargets(n.childForFieldName('left'), out);
  else if (['array_pattern', 'object_pattern', 'rest_pattern', 'array', 'object'].includes(n.type)) for (const c of n.namedChildren) jsTargets(c, out);
}

/** The keys of a destructuring pattern (`{ skip: omit }`, `{ ['skip']: omit }`, `{ skip }`): part of what the binding holds. */
function jsPatternKeys(p: Node | null): Node[] {
  if (!p) return [];
  return p.descendantsOfType(['pair_pattern', 'shorthand_property_identifier_pattern', 'pair']).map((k) => (k.type === 'shorthand_property_identifier_pattern' ? k : k.childForFieldName('key'))).filter((k): k is Node => k !== null);
}

/** JS/TS binding forms whose target and value are fields of the node: (target field, value field), by node type. */
const JS_BINDING_FIELDS: Readonly<Record<string, [string, string]>> = nameTable('JS_BINDING_FIELDS', {
  variable_declarator: ['name', 'value'],
  assignment_expression: ['left', 'right'],
  augmented_assignment_expression: ['left', 'right'],
  assignment_pattern: ['left', 'right'],
  object_assignment_pattern: ['left', 'right'],
  required_parameter: ['pattern', 'value'],
  optional_parameter: ['pattern', 'value'],
  for_in_statement: ['left', 'right'],
});

function jsBindings(root: Node): Binding[] {
  const out: Binding[] = [];
  const add = (target: Node | null, scan: Array<Node | null>, at: Node): void => {
    const names: string[] = [];
    jsTargets(target, names);
    const s = [...scan, ...jsPatternKeys(target)].filter((x): x is Node => x !== null);
    if (names.length > 0 && s.length > 0) out.push({ names, scan: s, line: at.startPosition.row + 1 });
  };
  for (const n of root.descendantsOfType([...Object.keys(JS_BINDING_FIELDS), 'public_field_definition', 'enum_assignment', 'import_specifier', 'class_declaration', 'class', 'abstract_class_declaration'])) {
    if (n.type === 'import_specifier') {
      add(n.childForFieldName('alias') ?? n.childForFieldName('name'), [n.childForFieldName('name')], n);
    } else if (n.type === 'public_field_definition' || n.type === 'enum_assignment') {
      // Best effort, outside the matrix: a class field (`omit = it.skip`, `static #k = 'skip'`,
      // `static ['omit'] = it.skip`) or an enum member (`S = 'skip'`), by its name read as a member (`this.omit`,
      // `A.#k`, `K.S`); a computed name only when it is a literal.
      const name = n.childForFieldName('name');
      const value = n.childForFieldName('value');
      if (name && value && JS_IDS.has(name.type)) out.push({ names: [nameAt(name, 'js')], scan: [value], line: n.startPosition.row + 1 });
      else if (name && value && name.type === 'computed_property_name') {
        const inner = name.namedChildren.find((c) => c.type !== 'comment');
        const literal = inner ? unwrap(inner) : null;
        const key = literal ? jsString(literal) : null;
        if (key !== null) out.push({ names: [key], scan: [value], line: n.startPosition.row + 1 });
      }
    } else if (n.type in JS_BINDING_FIELDS) {
      const [target, value] = JS_BINDING_FIELDS[n.type]!;
      add(n.childForFieldName(target), [n.childForFieldName(value)], n);
    } else {
      const decorators = n.namedChildren.filter((c) => c.type === 'decorator');
      if (decorators.length > 0) add(n.childForFieldName('name'), decorators, n);
    }
  }
  return out;
}

/** The names the file's bindings mark, and the names that hold a string of the vocabulary, to a fixed point (see the header). */
function markedNames(bindings: readonly Binding[], lang: Lang, tokens: Readonly<Record<string, MarkerKind>>, bound: ReadonlySet<string>, assertion: ReadonlySet<string>): Marks {
  const marked = new Map<string, Mark>();
  const held = new Map<string, Mark>();
  const marks: Marks = { marked, held, bound, assertion };
  /** Records what a binding's value holds on every name it binds; whether anything changed. */
  const record = (into: Map<string, Mark>, b: Binding, scan: Scan): boolean => {
    let found: Mark | null = null;
    for (const s of b.scan) {
      const m = bears(s, lang, tokens, marks, scan);
      if (!m) continue;
      if (!found) found = { kinds: new Set(m.kinds), token: m.token, string: m.string, via: { name: '', line: b.line, through: m.via?.name ?? null } };
      else for (const k of m.kinds) found.kinds.add(k);
    }
    if (!found) return false;
    let changed = false;
    for (const name of b.names) {
      const before = into.get(name);
      if (!before) {
        into.set(name, { kinds: new Set(found.kinds), token: found.token, string: found.string, via: { name, line: b.line, through: found.via?.through ?? null } });
        changed = true;
      } else {
        for (const k of found.kinds) {
          if (!before.kinds.has(k)) {
            before.kinds.add(k);
            changed = true;
          }
        }
      }
    }
    return changed;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of bindings) {
      if (record(marked, b, 'value')) changed = true;
      if (record(held, b, 'string')) changed = true;
    }
  }
  return marks;
}

// --- uses ----------------------------------------------------------------------------------------

/** A test of the extractor as the net names it: its declaration line, the name a finding gives it, and the name it is declared with. */
export interface NetTest {
  line: number;
  name: string;
  declared: string;
}

/** The extractor's tests of one side, named as at head (`rename`: a base test's head name, by the matching). */
export function netTests(tests: readonly TestCase[], rename: (name: string) => string = (n) => n): NetTest[] {
  return tests.map((t) => ({ line: t.line, name: rename(t.name), declared: t.name }));
}

/** The test a use stands in (or declares): by the extractor's tests and their declaration lines. */
function testOf(use: Node, lang: Lang, tests: readonly NetTest[]): string | null {
  const byLine = (line: number): NetTest[] => tests.filter((t) => t.line === line);
  for (let n: Node | null = use; n; n = n.parent) {
    if (lang === 'python') {
      const def = n.type === 'decorated_definition' ? n.childForFieldName('definition') : n.type === 'function_definition' ? n : null;
      if (def?.type === 'function_definition') {
        const found = byLine(def.startPosition.row + 1);
        if (found.length > 0) return found[0]!.name;
      }
    } else if (n.type === 'call_expression') {
      const found = byLine(n.startPosition.row + 1);
      const title = jsString(n.childForFieldName('arguments')?.namedChildren[0]);
      const named = found.length === 1 ? found : found.filter((t) => title === null || t.declared === title || t.declared.endsWith(` > ${title}`));
      if (named.length > 0) return named[0]!.name;
      // A test declared through a name the extractor does not read (`later('b', () => {…})`): its title.
      if (n.id === use.id && title !== null && n.childForFieldName('arguments')?.namedChildren.some((a) => ['arrow_function', 'function_expression', 'function'].includes(unwrap(a).type))) return title;
    }
  }
  return null;
}

/** Every use of the vocabulary in a file: a call, a decorator or a raise whose callee — all of it, never the final arguments — bears it. */
export async function contagionUses(path: string, source: string, tests: readonly NetTest[]): Promise<ContagionUse[]> {
  const language = languageForPath(path);
  if (!language) return [];
  const lang: Lang = language === 'python' ? 'python' : 'js';
  const tokens = lang === 'python' ? PY_TOKENS : TS_TOKENS;
  const tree = (await getParser(language)).parse(source);
  if (!tree) return [];
  try {
    const root = tree.rootNode;
    const marks = markedNames(lang === 'python' ? pythonBindings(root) : jsBindings(root), lang, tokens, boundNames(root, lang), lang === 'js' ? assertionNames(root) : new Set());
    const callable = Object.fromEntries(Object.entries(tokens).filter(([t]) => !RAISE_ONLY.has(t)));
    const out: ContagionUse[] = [];
    const consumed = new Set<number>();
    const callTypes = lang === 'python' ? ['decorator', 'raise_statement', 'call'] : ['decorator', 'call_expression'];
    // Decorators and raises first: a call they hold is one use with them, not two.
    const nodes = callTypes.flatMap((t) => root.descendantsOfType(t));
    for (const n of nodes) {
      if (consumed.has(n.id)) continue;
      let form: ContagionUse['form'];
      let callee: Node | null;
      if (n.type === 'decorator' || n.type === 'raise_statement') {
        // What a decorator applies or a raise raises is read as what a call calls: an ordinary call in it
        // stands for its callee (its arguments are the final ones), a by-name access (`getattr(pytest.mark,
        // "skip")`, `Reflect.get(…)`) is transparent and read whole, as `pytest.mark.skip` would be.
        form = n.type === 'decorator' ? 'decorator' : 'raise';
        const expr = n.namedChildren.find((c) => c.type !== 'comment') ?? null;
        if (!expr) continue;
        const inner = unwrap(expr);
        if (inner.type === 'call' || inner.type === 'call_expression') {
          consumed.add(inner.id);
          callee = opaqueArgs(inner, lang) === null ? expr : inner.childForFieldName('function');
        } else callee = expr;
      } else {
        form = 'call';
        callee = n.childForFieldName('function');
      }
      if (!callee) continue;
      const mark = bears(callee, lang, form === 'call' ? callable : tokens, marks, 'callee');
      if (!mark) continue;
      out.push({
        form,
        callee: callee.text.replace(/\s+/g, ''),
        line: n.startPosition.row + 1,
        calleeEnd: callee.endPosition.row + 1,
        test: testOf(n, lang, tests),
        mark,
      });
    }
    return out.sort((a, b) => a.line - b.line);
  } finally {
    tree.delete();
  }
}

export interface ContagionFile {
  basePath: string | null;
  headPath: string;
  base: string | null;
  head: string;
  baseTests: readonly NetTest[];
  headTests: readonly NetTest[];
}

const key = (u: ContagionUse): string => `${u.form}\0${u.callee}\0${u.test ?? ''}`;

/** The uses at head that base did not have (by form, callee and test), in order. */
export function newUses(base: readonly ContagionUse[], head: readonly ContagionUse[]): ContagionUse[] {
  const left = new Map<string, number>();
  for (const u of base) left.set(key(u), (left.get(key(u)) ?? 0) + 1);
  const out: ContagionUse[] = [];
  for (const u of head) {
    const n = left.get(key(u)) ?? 0;
    if (n > 0) left.set(key(u), n - 1);
    else out.push(u);
  }
  return out;
}

const FORM: Record<ContagionUse['form'], string> = { call: 'a call of', decorator: 'the decorator', raise: 'a raise of' };

/**
 * A WARN for every new use of the vocabulary in the changed test files, unless `covered` says a
 * finding of the extractor already stands on it (same file, a line between the use and its callee's end).
 */
export async function contagionNet(files: readonly ContagionFile[], rules: readonly RuleId[], covered: (file: string, from: number, to: number, focus: boolean) => boolean): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const f of files) {
    const base = f.base === null || f.basePath === null ? [] : await contagionUses(f.basePath, f.base, f.baseTests);
    const head = await contagionUses(f.headPath, f.head, f.headTests);
    const seen = new Set<number>();
    // Tests the extractor reads at head with no counterpart at base: a disabling use in one loses nothing (NEW_TEST).
    const baseNames = new Set(f.baseTests.map((t) => t.name));
    const headNames = new Set(f.headTests.map((t) => t.name));
    for (const u of newUses(base, head)) {
      const kinds = [...u.mark.kinds];
      const rule: RuleId = kinds.length > 0 && kinds.every((k) => k === 'only') ? 'TG002' : 'TG003';
      if (!rules.includes(rule) || seen.has(u.line) || covered(f.headPath, u.line, u.calleeEnd, kinds.includes('only'))) continue;
      seen.add(u.line);
      if (u.test !== null && headNames.has(u.test) && !baseNames.has(u.test) && !kinds.includes('only')) {
        findings.push({
          rule,
          severity: 'info',
          file: f.headPath,
          side: 'head',
          line: u.line,
          test: u.test,
          message: `Adds ${FORM[u.form]} \`${u.callee.length > 60 ? `${u.callee.slice(0, 57)}...` : u.callee}\` to new test "${u.test}", which did not exist at base: no test that existed loses anything`,
          reason: NEW_TEST,
        });
        continue;
      }
      const kind: MarkerKind = kinds.find((k) => k !== 'only') ?? 'only';
      const via = u.mark.via;
      const what = u.mark.string === null
        ? `\`${u.mark.token}\`, a token of the skip/focus vocabulary`
        : u.mark.string === 'token'
          ? `the string \`${u.mark.token}\`, a member's name in the skip/focus vocabulary`
          : `the string \`${u.mark.token}\`, whose value is not certain`;
      const why = !via
        ? `its callee holds ${what}`
        : via.through
          ? `\`${via.name}\` is bound at line ${via.line} to a value that holds \`${via.through}\`, itself bound to ${u.mark.string === null ? `the skip/focus vocabulary (\`${u.mark.token}\`)` : `a value that holds ${what}`}`
          : `\`${via.name}\` is bound at line ${via.line} to a value that holds ${what}`;
      findings.push({
        rule,
        severity: 'warn',
        file: f.headPath,
        side: 'head',
        line: u.line,
        test: u.test,
        message: `Adds ${FORM[u.form]} \`${u.callee.length > 60 ? `${u.callee.slice(0, 57)}...` : u.callee}\`${u.test ? ` to test "${u.test}"` : ''}: ${why}; it ${MAY[kind](u.test ? 'it' : 'a test')}`,
      });
    }
  }
  return findings;
}
