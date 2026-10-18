// The one normalisation of expressions, keys, literals and strings (docs/rules.md, *Attribution*).
//
// What does nothing at run time is read away, the same way by every reader — the extractor
// (src/parse/ts.ts, ts-binding.ts, py.ts), the safety nets (src/rules/net.ts, contagion.ts) and the
// config readers (src/config/js.ts): parentheses and TypeScript's type assertions (`x as T`, `x as
// const`, `x satisfies T`, `x!`, `<T>x`, `x<T>`), in an expression, a subscript (`it[('skip')]`,
// `it['skip' as const]`) and a computed key (`{ [('skip')]: omit }`). A literal is read as the
// language reads it: escapes decoded (`'skip'`, `'\163kip'` in sloppy JavaScript,
// `"\x73kip"` in Python), adjacent Python literals joined (`"sk" "ip"`, joined at compile time). A
// value computed at run time (`'sk' + 'ip'`, a template or an f-string with a substitution) is not a
// literal: null.
import ts from 'typescript';
import type { Node } from 'web-tree-sitter';
import { nameTable } from '../util/names.js';
import { BY_NAME_PRIMITIVES, type ByNamePrimitive } from '../rules/guarantee.js';

/** JavaScript's one-character escapes (`\n`…); any other character escapes itself. */
const JS_SIMPLE_ESCAPES: Readonly<Record<string, string>> = nameTable('JS_SIMPLE_ESCAPES', { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v' });
/** Python's simple escapes (`\n`, `\'`…); an unknown escape keeps its backslash. */
const PY_SIMPLE_ESCAPES: Readonly<Record<string, string>> = nameTable('PY_SIMPLE_ESCAPES', { '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' });

/**
 * The wrappers that change nothing at run time, in the tree-sitter grammars (JavaScript/TypeScript,
 * Python) and in the TypeScript compiler, side by side: one list.
 */
export const WRAPPERS: ReadonlyArray<{ form: string; treeSitter: string; compiler: string }> = [
  { form: '(x)', treeSitter: 'parenthesized_expression', compiler: 'ParenthesizedExpression' },
  { form: 'x as T, x as const', treeSitter: 'as_expression', compiler: 'AsExpression' },
  { form: 'x satisfies T', treeSitter: 'satisfies_expression', compiler: 'SatisfiesExpression' },
  { form: 'x!', treeSitter: 'non_null_expression', compiler: 'NonNullExpression' },
  { form: '<T>x', treeSitter: 'type_assertion', compiler: 'TypeAssertionExpression' },
  { form: 'x<T>', treeSitter: 'instantiation_expression', compiler: 'ExpressionWithTypeArguments' },
];
const TREE_SITTER_WRAPPERS = new Set(WRAPPERS.map((w) => w.treeSitter));
const COMPILER_WRAPPERS = new Set(WRAPPERS.map((w) => ts.SyntaxKind[w.compiler as keyof typeof ts.SyntaxKind]));

/** The expression one wrapper holds (`x` of `(x)`, `x as T`, `<T>x`…); null for a sequence `(a, b)` or a tuple. */
function innerOf(n: Node): Node | null {
  const named = n.namedChildren.filter((c) => c.type !== 'comment');
  // The expression: the last child of `<T>x`, the first of the others (`x as T`, `x!`, `(x)`, `x<T>`).
  const inner = n.type === 'type_assertion' ? named.at(-1) : named[0];
  // `(a, b)` is a sequence, not one expression wrapped.
  if (!inner || (n.type === 'parenthesized_expression' && named.length !== 1) || inner.type === 'sequence_expression') return null;
  return inner;
}

/** Whether a tree-sitter node is a no-op wrapper of one expression (see WRAPPERS). */
export function isWrapper(n: Node): boolean {
  return TREE_SITTER_WRAPPERS.has(n.type) && innerOf(n) !== null;
}

/** `(x)`, `x as T`, `x as const`, `x!`, `<T>x`, `x satisfies T`, `x<T>` → `x` (tree-sitter, JS/TS and Python). */
export function unwrap(node: Node): Node {
  let n = node;
  while (TREE_SITTER_WRAPPERS.has(n.type)) {
    const inner = innerOf(n);
    if (!inner) break;
    n = inner;
  }
  return n;
}

/** The outermost no-op wrapper around `node` (itself when it has none). */
export function outerWrap(node: Node): Node {
  let n = node;
  while (n.parent && TREE_SITTER_WRAPPERS.has(n.parent.type) && unwrap(n.parent).id === unwrap(n).id) n = n.parent;
  return n;
}

/** The same wrappers on a TypeScript compiler expression (see WRAPPERS): every one of them holds `expression`. */
export function unwrapTs(e: ts.Node): ts.Node {
  let n = e;
  while (COMPILER_WRAPPERS.has(n.kind)) n = (n as ts.Node & { expression: ts.Node }).expression;
  return n;
}

/** The outermost wrapper around a TypeScript compiler node (itself when it has none). */
export function outerTs(node: ts.Node): ts.Node {
  let n = node;
  while (n.parent && COMPILER_WRAPPERS.has(n.parent.kind)) n = n.parent;
  return n;
}

// ---------------------------------------------------------------------------------------------------
// JavaScript / TypeScript

/**
 * A JavaScript string body with its escapes decoded as the language does: `\u{…}`, `\uXXXX`, `\xXX`,
 * `\0` (not before a digit), the simple escapes, a line continuation, and any other character escaped
 * as itself. Null when the value is not certain: a malformed escape, or a legacy octal one (`\163`,
 * `\8`), which only sloppy code reads (a module or TypeScript rejects the file).
 */
export function decodeJs(body: string): string | null {
  let bad = false;
  const out = body.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(0(?![0-9]))|([0-9])|(\r\n|[\s\S]))/g, (_m, _all, cp: string, u4: string, x2: string, nul: string, digit: string, ch: string) => {
    if (cp !== undefined) {
      const v = parseInt(cp, 16);
      if (v > 0x10ffff) bad = true;
      return v > 0x10ffff ? '' : String.fromCodePoint(v);
    }
    if (u4 !== undefined) return String.fromCharCode(parseInt(u4, 16));
    if (x2 !== undefined) return String.fromCharCode(parseInt(x2, 16));
    if (nul !== undefined) return '\0';
    if (digit !== undefined || ch === 'u' || ch === 'x') {
      bad = true;
      return '';
    }
    if (ch === '\n' || ch === '\r' || ch === '\r\n' || ch === '\u2028' || ch === '\u2029') return ''; // a line continuation
    return JS_SIMPLE_ESCAPES[ch] ?? ch;
  });
  return bad ? null : out;
}

/** The name a JavaScript identifier stands for, its unicode escapes decoded (`it` is `it`). */
export function jsName(id: Node): string {
  return /\\u/.test(id.text) ? (decodeJs(id.text) ?? id.text) : id.text;
}

/** The value of a JavaScript string literal, or a template with no substitution, after unwrapping; null for anything else. */
export function jsString(node: Node | null | undefined): string | null {
  if (!node) return null;
  const n = unwrap(node);
  if (n.type === 'string') return decodeJs(n.text.slice(1, -1));
  if (n.type === 'template_string' && !n.namedChildren.some((c) => c.type === 'template_substitution')) return decodeJs(n.text.slice(1, -1));
  return null;
}

/**
 * The literal name of a JavaScript property key: an identifier (`skip`), a string (`'skip'`), a number,
 * or a computed key whose expression is a literal after unwrapping (`['skip']`, `[('skip')]`,
 * `['skip' as const]`); null for a key computed at run time.
 */
export function jsKey(key: Node | null | undefined): string | null {
  if (!key) return null;
  if (['identifier', 'property_identifier', 'shorthand_property_identifier', 'shorthand_property_identifier_pattern', 'private_property_identifier'].includes(key.type)) return jsName(key);
  if (key.type === 'number') return key.text;
  if (key.type === 'computed_property_name') {
    const inner = key.namedChildren.find((c) => c.type !== 'comment');
    if (!inner) return null;
    const v = unwrap(inner);
    return v.type === 'number' ? v.text : jsString(v);
  }
  return jsString(key);
}

/** `x.name` or `x[<literal>]` (after unwrapping the index): its object and member name; null for anything else. */
export function jsMember(node: Node): { object: Node; property: Node; name: string } | null {
  const n = unwrap(node);
  if (n.type === 'member_expression') {
    const object = n.childForFieldName('object');
    const property = n.childForFieldName('property');
    return object && property ? { object, property, name: jsName(property) } : null;
  }
  if (n.type === 'subscript_expression') {
    const object = n.childForFieldName('object');
    const index = n.childForFieldName('index');
    const name = jsString(index);
    return object && index && name !== null ? { object, property: index, name } : null;
  }
  return null;
}

/** One member access: its object, the node that names the member, the name, and whether the name is read from a string. */
export interface MemberStep {
  object: Node;
  /** The property, the literal index, or the by-name access's literal name. */
  property: Node;
  name: string;
  /** The name is a string literal (`'k'` of `x['k']`, of `getattr(x, 'k')`): read as written, never mangled. */
  literal: boolean;
}

/** The arguments of a call as written, when every one is positional (no spread, no keyword); null otherwise. */
function positionalArgs(call: Node, lang: 'js' | 'python'): Node[] | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;
  const named = args.namedChildren.filter((c) => c.type !== 'comment');
  const other = lang === 'js' ? ['spread_element'] : ['keyword_argument', 'list_splat', 'dictionary_splat', 'parenthesized_list_splat'];
  return named.some((a) => other.includes(a.type)) ? null : named;
}

/** A call of a by-name primitive that returns the member (src/rules/guarantee.ts, `reads`), with a literal name: its member step. */
function byNameStep(n: Node, lang: 'js' | 'python'): MemberStep | null {
  if (n.type !== (lang === 'js' ? 'call_expression' : 'call')) return null;
  const fn = n.childForFieldName('function');
  if (!fn) return null;
  let primitive: ByNamePrimitive | undefined;
  if (lang === 'js') {
    // `Reflect.get`, `Reflect['get']`: the callee is itself a member, by a dot or a literal subscript.
    const m = jsMember(fn);
    const object = m ? unwrap(m.object) : null;
    if (!m || object?.type !== 'identifier' || jsName(object) !== BY_NAME_PRIMITIVES.js.object) return null;
    primitive = BY_NAME_PRIMITIVES.js.members.find((p) => p.name === m.name);
  } else {
    const f = unwrap(fn);
    if (f.type !== 'identifier') return null;
    primitive = BY_NAME_PRIMITIVES.python.find((p) => p.name === pyName(f));
  }
  if (!primitive?.reads) return null;
  const args = positionalArgs(n, lang);
  if (!args || args.length < primitive.args[0] || args.length > primitive.args[1]) return null;
  const name = lang === 'js' ? jsString(args[1]) : pyString(args[1]);
  return name === null ? null : { object: args[0]!, property: args[1]!, name, literal: true };
}

/**
 * One member access, read the same way however it is written — a dot, a literal subscript, or a by-name primitive
 * that returns the member with a literal name (`x.k` ≡ `x['k']` ≡ `x[('k' as const)]` ≡ `Reflect.get(x, 'k')` ≡
 * `Reflect['get'](x, 'k')` in JS/TS; `x.k` ≡ `x["k"]` ≡ `getattr(x, "k")` ≡ `getattr(x, "k", default)` in Python) —
 * after unwrapping; null for anything else (another call, a subscript or a name computed at run time).
 */
export function memberStep(node: Node, lang: 'js' | 'python'): MemberStep | null {
  const n = unwrap(node);
  const byName = byNameStep(n, lang);
  if (byName) return byName;
  if (lang === 'js') {
    const m = jsMember(n);
    return m ? { ...m, literal: n.type === 'subscript_expression' } : null;
  }
  if (n.type === 'attribute') {
    const object = n.childForFieldName('object');
    const property = n.childForFieldName('attribute');
    return object && property ? { object, property, name: pyName(property), literal: false } : null;
  }
  if (n.type === 'subscript') {
    const object = n.childForFieldName('value');
    const index = n.childrenForFieldName('subscript');
    const name = index.length === 1 ? pyString(index[0]) : null;
    return object && name !== null ? { object, property: index[0]!, name, literal: true } : null;
  }
  return null;
}

/** A name of a member chain: the node as written (an identifier, `this`, a property, a literal name) and the name it stands for. */
export interface ChainName {
  node: Node;
  name: string;
  /** Whether the name is read from a string (`'k'` of `x['k']` or of `getattr(x, 'k')`): as written, never mangled. */
  literal: boolean;
}

/**
 * A receiver chain as a path of names, root first: `this.a['b']` → this, a, b; `getattr(box, "k").c` → box, k, c.
 * Its root is an identifier, or `this` (JS) — `self` is an identifier — and every step a member access as
 * `memberStep` reads it (a dot, a literal subscript, a by-name primitive returning the member: the same member
 * however written, in any position). Null when the chain goes through anything else: another call (`f().omit`,
 * `getBox()['omit']`) or a name computed at run time (`a[k].omit`).
 */
export function memberChain(node: Node, lang: 'js' | 'python'): ChainName[] | null {
  const path: ChainName[] = [];
  let n = unwrap(node);
  for (let step = memberStep(n, lang); step; step = memberStep(n, lang)) {
    path.unshift({ node: step.property, name: step.name, literal: step.literal });
    n = unwrap(step.object);
  }
  if (n.type === 'identifier') path.unshift({ node: n, name: lang === 'js' ? jsName(n) : pyName(n), literal: false });
  else if (lang === 'js' && n.type === 'this') path.unshift({ node: n, name: 'this', literal: false });
  else return null;
  return path;
}

/** The literal name of a TypeScript compiler property or binding name (`skip`, `'skip'`, `[('skip' as const)]`); null when computed. */
export function tsKey(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const e = unwrapTs(name.expression);
    if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e)) return e.text;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Python

/** The name a Python identifier stands for: NFKC-normalised, as CPython reads identifiers (`pyteſt` is `pytest`). */
export function pyName(id: Node): string {
  return id.text.normalize('NFKC');
}

/** A Python string body with its escapes decoded (a `str`, not raw); null where the value is not certain (`\N{…}`). */
function decodePy(body: string): string | null {
  let bad = false;
  const out = body.replace(/\\(\r\n|\n|\r|[\\'"abfnrtv]|[0-7]{1,3}|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|N\{[^}]*\}|[\s\S])/g, (m, e: string) => {
    if (e === '\n' || e === '\r' || e === '\r\n') return '';
    if (/^[0-7]{1,3}$/.test(e)) return String.fromCodePoint(parseInt(e, 8));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'U' && e.length === 9) {
      const v = parseInt(e.slice(1), 16);
      if (v > 0x10ffff) bad = true;
      return v > 0x10ffff ? '' : String.fromCodePoint(v);
    }
    if (e[0] === 'N' && e.length > 1) {
      bad = true; // a character by its Unicode name: not decoded here
      return '';
    }
    return PY_SIMPLE_ESCAPES[e] ?? m; // an unknown escape keeps its backslash in Python
  });
  return bad ? null : out;
}

/**
 * The value of a Python string literal (`'skip'`, `r'skip'`, `"\x73kip"`, adjacent literals joined:
 * `"sk" "ip"`), after unwrapping; null for bytes, an f-string with a substitution, or an escape whose
 * value is not certain.
 */
export function pyString(node: Node | null | undefined): string | null {
  if (!node) return null;
  const n = unwrap(node);
  if (n.type === 'concatenated_string') {
    let out = '';
    for (const part of n.namedChildren) {
      const v = pyString(part);
      if (v === null) return null;
      out += v;
    }
    return out;
  }
  if (n.type !== 'string') return null;
  if (n.namedChildren.some((c) => c.type === 'interpolation')) return null;
  const start = n.namedChildren.find((c) => c.type === 'string_start');
  const end = n.namedChildren.find((c) => c.type === 'string_end');
  if (!start || !end) return null;
  const prefix = start.text.replace(/['"]+$/, '').toLowerCase();
  if (prefix.includes('b')) return null;
  const body = n.text.slice(start.endIndex - n.startIndex, end.startIndex - n.startIndex);
  if (prefix.includes('f') && /[{}]/.test(body)) return null;
  return prefix.includes('r') ? body : decodePy(body);
}
