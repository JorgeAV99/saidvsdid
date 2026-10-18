// The runner's API by binding, for Python (docs/rules.md, *Attribution: the runner's API by
// binding*). saidvsdid does not resolve Python's scopes itself: Python does (`ast` and `symtable`,
// python/saidvsdid_scopes.py, run by py-scopes.ts), and this module reads its answer for the names
// tree-sitter's extraction meets. It assumes that the test framework and its objects are not modified
// at run time (monkeypatching, setattr/__setattr__, reflection, __globals__, writes to members, a
// dynamic import to mutate), neither from other modules nor from the file itself.
//
// The rule is about the file, not about one occurrence: a name imported from pytest or unittest is
// certainly the runner's only when Python shows exactly one binding of it in the whole file, a
// module-level `import` of pytest/unittest, symtable classifies it in every other table as the
// module's global and nothing else, it does not start with `__`, it is not a builtin, and the file has
// no star import (the script's header has the details).
// Then every occurrence of the name refers to that import. Otherwise every occurrence is uncertain,
// read under the path the import gives it, and the rules warn ("may …").
//
// Aliases: a binding of any form whose value contains a reference rooted in a runner import
// (`omit = pytest.mark.skip(reason=…)`, `stop = unittest.SkipTest("x")`, `(omit := …)`, a default,
// `for`, `with … as`, a decorator) makes its names one-step aliases: each use as a decorator, a call
// or a raise reads as the form, never certain. Beyond one step (an alias of an alias, a container),
// the contagion net is the guarantee (src/rules/contagion.ts).
//
// `self.<method>()` (`skipTest`, `assertEqual`, `fail`) is unittest's only when the method's first
// parameter is bound nowhere else in its body (nested scopes included), the method is undecorated,
// its class reaches unittest.TestCase through bases of the module that are certain, and the file
// binds the method's name (and `__getattribute__`) nowhere, by any form (case B).
//
// When Python cannot read the file (no interpreter, an unsupported version, a file it does not
// compile), nothing in it is certain; the file gets one WARN (src/check.ts).
//
// Expressions are read with their parentheses removed: `raise (unittest.SkipTest)` is `raise
// unittest.SkipTest`, `@(omit)` is `@omit`.
import type { Node } from 'web-tree-sitter';
import { outerWrap, pyName, unwrap } from './normalise.js';
import type { PyFacts, PyLiteral, PyRange } from './py-scopes.js';
import { pythonIndex, pythonLineStarts } from './positions.js';
import { CERTAIN, uncertain, type Binding, type MarkerKind } from './types.js';
import { PY_MARK_KINDS, PY_PYTEST_CALL_KINDS, PY_UNITTEST_EXCEPTIONS, PY_UNITTEST_KINDS } from './vocabulary.js';

/** Python's private name mangling: `__x` used in the body of class `C` is `_C__x` (a dunder or a dotted name is not). */
export function mangle(name: string, cls: string | null): string {
  if (cls === null || !name.startsWith('__') || name.endsWith('__') || name.includes('.')) return name;
  const stripped = cls.replace(/^_+/, '');
  return stripped ? `_${stripped}${name}` : name;
}

/** The class whose body holds `node` (its methods included): where Python mangles the names `node` uses. */
export function manglingClass(node: Node): string | null {
  let child = node;
  for (let p = node.parent; p; child = p, p = p.parent) {
    if (p.type !== 'class_definition') continue;
    const body = p.childForFieldName('body');
    const name = p.childForFieldName('name');
    if (body && name && child.id === body.id) return pyName(name);
  }
  return null;
}

// The vocabulary (src/parse/vocabulary.ts, the one definition).
const MARK_KINDS = PY_MARK_KINDS;
const UNITTEST_KINDS = PY_UNITTEST_KINDS;
const PYTEST_CALL_KINDS = PY_PYTEST_CALL_KINDS;
const RUNNER_MODULES = new Set(['pytest', 'unittest']);

/** The marker kind of a path of the vocabulary (`pytest.mark.skip`, `unittest.skipIf`, `pytest.xfail`, `…SkipTest`), or null. */
export function pathKind(path: readonly string[]): MarkerKind | null {
  const last = path[path.length - 1]!;
  if (path[path.length - 2] === 'mark') return MARK_KINDS[last] ?? null;
  if (path.length === 2 && path[0] === 'unittest') return UNITTEST_KINDS[last] ?? null;
  if (path.length === 2 && path[0] === 'pytest') return PYTEST_CALL_KINDS[last] ?? null;
  return PY_UNITTEST_EXCEPTIONS[last] ?? null;
}

/** `a.b.c`, `(a).b`, `(a.b.c)` → the identifiers [a, b, c]; null for anything but a dotted name. */
function dottedIdentifiers(expr: Node): Node[] | null {
  const node = unwrap(expr);
  if (node.type === 'identifier') return [node];
  if (node.type === 'attribute') {
    const object = node.childForFieldName('object');
    const attr = node.childForFieldName('attribute');
    const base = object ? dottedIdentifiers(object) : null;
    return base && attr ? [...base, attr] : null;
  }
  return null;
}

export interface Resolved {
  /** The canonical path (`skip_if` → `unittest.skipIf`, `omit` → `pytest.mark.skip`), or the path as written. */
  path: string[];
  binding: Binding;
  /** A one-step alias of a call (`skip_win = pytest.mark.skipif(…)`): the call, for its arguments. */
  aliasCall?: Node;
  /** Read through an alias (a binding whose value is or contains the path). */
  viaAlias?: true;
}

/**
 * Names an import statement of pytest or unittest binds anywhere in the file, as tree-sitter reads
 * them: only to keep reading the vocabulary (uncertain) when Python cannot read the file.
 */
function importedNames(root: Node): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const stmt of root.descendantsOfType(['import_statement', 'import_from_statement'])) {
    if (stmt.type === 'import_statement') {
      for (const name of stmt.childrenForFieldName('name')) {
        const dotted = (name.type === 'aliased_import' ? name.childForFieldName('name') : name)?.namedChildren.map(pyName) ?? [];
        const alias = name.type === 'aliased_import' ? name.childForFieldName('alias') : null;
        if (!RUNNER_MODULES.has(dotted[0] ?? '')) continue;
        if (alias && dotted.length === 1) out.set(pyName(alias), dotted);
        else if (!alias) out.set(dotted[0]!, [dotted[0]!]);
      }
    } else {
      const module = stmt.childForFieldName('module_name');
      const m = module?.type === 'dotted_name' ? module.namedChildren.map(pyName).join('.') : null;
      if (m === null || !RUNNER_MODULES.has(m)) continue;
      for (const name of stmt.childrenForFieldName('name')) {
        const original = name.type === 'aliased_import' ? name.childForFieldName('name') : name;
        const local = name.type === 'aliased_import' ? name.childForFieldName('alias') : name;
        if (original && local) out.set(pyName(local).split('.').at(-1)!, [m, pyName(original)]);
      }
    }
  }
  return out;
}

export class PyResolver {
  readonly facts: PyFacts;
  private starts: number[] | null = null;
  private fallback: Map<string, string[]> | null = null;

  /**
   * @param source the file's text, as tree-sitter reads it;
   * @param facts Python's answer for the file's bytes, taken once by the caller (src/check.ts, where a file's base
   *   and head are judged together; `parseTestFile` for a standalone parse). The resolver never asks the reader.
   */
  constructor(
    private readonly root: Node,
    private readonly source: string,
    facts: PyFacts,
  ) {
    this.facts = facts;
  }

  /** The UTF-16 index of Python's (line, UTF-8 column) in this source (positions.ts). */
  private index(line: number, column: number): number | null {
    this.starts ??= pythonLineStarts(this.source);
    return pythonIndex(this.source, this.starts, line, column);
  }

  /** The tree-sitter node of one of `types` that Python's range covers exactly; null when the parsers disagree. */
  private nodeAt(range: PyRange, types: readonly string[]): Node | null {
    const start = this.index(range[0], range[1]);
    const end = this.index(range[2], range[3]);
    if (start === null || end === null || end <= start) return null;
    for (let n: Node | null = this.root.descendantForIndex(start, end - 1); n; n = n.parent) {
      if (n.startIndex < start || n.endIndex > end) break;
      if (n.startIndex === start && n.endIndex === end && types.includes(n.type)) return n;
    }
    return null;
  }

  /**
   * The canonical path a dotted expression stands for, or its written path when its root is not a
   * runner import or a one-step alias of one, and whether it is certainly the runner's.
   */
  dotted(expr: Node): Resolved | null {
    const ids = dottedIdentifiers(expr);
    if (!ids) return null;
    const raw = pyName(ids[0]!);
    // The name Python looks up: mangled in a class body (`__omit` in class `TestX` is `_TestX__omit`).
    const cls = manglingClass(ids[0]!);
    const name = mangle(raw, cls);
    const written = ids.map(pyName);
    const rest = written.slice(1);
    const facts = this.facts;
    if (!facts.ok) {
      this.fallback ??= importedNames(this.root);
      const canonical = this.fallback.get(name) ?? this.fallback.get(raw);
      return { path: canonical ? [...canonical, ...rest] : written, binding: uncertain(facts.why) };
    }
    const read = this.readName(name, rest, facts);
    if (read) return read;
    if (name !== raw) {
      // The name as written, shaped like the vocabulary but not what Python looks up here: never certain, never silence.
      const shaped = this.readName(raw, rest, facts);
      if (shaped) return { ...shaped, binding: uncertain(`inside class \`${cls}\` Python reads \`${raw}\` as \`${name}\`, not as the module's \`${raw}\``) };
    }
    return { path: written, binding: uncertain(`\`${name}\` is not imported from pytest or unittest`) };
  }

  /** The reading Python's facts give a name (already mangled): an alias of the vocabulary, a runner import, or null. */
  private readName(name: string, rest: string[], facts: Extract<PyFacts, { ok: true }>): Resolved | null {
    // A binding whose value is, or contains, a form of the vocabulary: read as that form, never certain.
    for (const alias of facts.aliases) {
      if (!alias.targets.includes(name)) continue;
      for (const ref of alias.refs) {
        const precise = ref.whole !== null;
        if (!precise && (rest.length > 0 || !pathKind(ref.path))) continue;
        const why = precise
          ? `\`${name}\` is an alias of \`${ref.path.join('.')}${ref.whole === 'call' ? '(…)' : ''}\` (line ${alias.line})`
          : `\`${name}\` is bound (line ${alias.line}) to a value that contains \`${ref.path.join('.')}\``;
        const call = ref.call && rest.length === 0 ? this.nodeAt(ref.call, ['call']) : null;
        return { path: [...ref.path, ...rest], binding: uncertain(why), viaAlias: true, ...(call ? { aliasCall: call } : {}) };
      }
    }
    const imported = facts.names[name];
    if (imported) return { path: [...imported.path, ...rest], binding: imported.why === null ? CERTAIN : uncertain(imported.why) };
    return null;
  }

  private literalAt: Map<number, PyLiteral> | null = null;

  /**
   * The value of an argument as Python's `ast.literal_eval` reads it (`(False)` and `0` are false), or null when it is
   * not a literal (a name, a call, an f-string) or Python could not read the file. Parentheses are Python's: the
   * argument is looked up without them.
   */
  literal(arg: Node): PyLiteral | null {
    const facts = this.facts;
    if (!facts.ok) return null;
    if (!this.literalAt) {
      this.literalAt = new Map();
      for (const l of facts.literals) {
        const at = this.index(l.at[0], l.at[1]);
        if (at !== null) this.literalAt.set(at, l);
      }
    }
    return this.literalAt.get(unwrap(arg).startIndex) ?? null;
  }

  /**
   * Whether the function `def` is a method of a class that certainly reaches unittest.TestCase through bases of the
   * module (the chain `selfMethod` reads): where `@unittest.expectedFailure` makes an expected failure.
   */
  testCaseMethod(def: Node): Binding {
    const facts = this.facts;
    if (!facts.ok) return uncertain(facts.why);
    const fact = facts.methods.find((m) => this.index(m.at[0], m.at[1]) === def.startIndex);
    if (!fact) return uncertain(`\`${def.childForFieldName('name')?.text ?? def.text}\` is not a method of a class`);
    return fact.chain === null ? CERTAIN : uncertain(fact.chain);
  }

  /**
   * Why the file may not bind `name` exactly once, by the statement saidvsdid reads (docs/rules.md, *Verdicts*, F7), or
   * null: Python's AST shows one binding of it in the whole file (any scope, any form), no star import, and nothing that
   * may rebind it at run time — builtins' `setattr`/`delattr` on the module, on something not resolved or on `owner`
   * (the class whose body binds `name`), a write through `globals()`/`vars()`, `exec`/`eval`.
   */
  boundOnce(name: string, owner: string | null = null): string | null {
    const facts = this.facts;
    if (!facts.ok) return facts.why;
    if (facts.star !== null) return `the module has a star import (line ${facts.star}), which may bind \`${name}\``;
    const dynamic = facts.dynamic.find((d) => d.scope === null || d.scope === owner);
    if (dynamic) return `the file may rebind names at run time (line ${dynamic.line}: builtins' \`setattr\`/\`delattr\`, \`globals()\`, \`vars()\`, \`exec\` or \`eval\`), \`${name}\` among them`;
    const n = facts.binds[name] ?? 0;
    return n === 1 ? null : `\`${name}\` is bound ${n} times in the file`;
  }

  /** The file binds `name` somewhere (any scope, any form): the first line, or null. */
  bindsAt(name: string): number | null {
    const facts = this.facts;
    if (!facts.ok) return null;
    return facts.bound[name] ?? null;
  }

  /** A class's bases read exactly (F7): none, or certainly unittest.TestCase; or why not. */
  classBases(cls: Node): { bases: 'none' | 'testcase' } | { why: string } {
    const facts = this.facts;
    if (!facts.ok) return { why: facts.why };
    const fact = facts.classes.find((c) => this.index(c.at[0], c.at[1]) === cls.startIndex);
    if (!fact) return { why: `Python lists no class at line ${cls.startPosition.row + 1}` };
    return fact.bases !== null ? { bases: fact.bases } : { why: fact.why ?? `the bases of class \`${fact.name}\` are not read exactly` };
  }

  /** `self.<method>` in a test method: unittest.TestCase's (see the header) or why not. */
  selfMethod(self: Node, method: string): Binding {
    const facts = this.facts;
    if (!facts.ok) return uncertain(facts.why);
    const name = mangle(pyName(self), manglingClass(self));
    // The closest function whose body holds the use and that Python lists as a method of a class.
    let fact: (typeof facts.methods)[number] | null = null;
    for (let p: Node | null = self.parent; p && !fact; p = p.parent) {
      if (p.type !== 'function_definition') continue;
      const body = p.childForFieldName('body');
      if (!body || self.startIndex < body.startIndex || self.endIndex > body.endIndex) continue;
      const start = p.startIndex;
      fact = facts.methods.find((m) => this.index(m.at[0], m.at[1]) === start) ?? null;
    }
    if (!fact) return uncertain(`\`${self.text}\` is not the parameter of a method`);
    if (fact.param !== name) return uncertain(`\`${self.text}\` is not the first parameter of the method \`${fact.name}\``);
    if (fact.self !== null) return uncertain(fact.self);
    if (fact.chain !== null) return uncertain(fact.chain);
    for (const bound of [method, '__getattribute__']) {
      const at = facts.bound[bound];
      if (at !== undefined) return uncertain(`the file binds \`${bound}\` (line ${at}), which may be what \`${self.text}.${method}\` is`);
    }
    const written = facts.written[method];
    if (written !== undefined) return uncertain(`\`${method}\` is written at line ${written}: outside the assumption, it may not be unittest's`);
    return CERTAIN;
  }
}
