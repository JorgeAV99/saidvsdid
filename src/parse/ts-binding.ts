// The runner's API by binding, for JavaScript/TypeScript (docs/rules.md, *Attribution: the runner's
// API by binding*). saidvsdid does not resolve scopes itself: the TypeScript compiler does
// (ts-program.ts: a program of the one file, no lib, no types, no module resolution, JavaScript
// allowed), and this module asks it, at each occurrence tree-sitter's extraction meets, which symbol
// the name is (`checker.getSymbolAtLocation`, the local symbol, never followed through the import).
// It assumes that the test framework and its objects are not modified at run time.
//
// A name is certainly the runner's only when that symbol has exactly one declaration and it is an
// import specifier, a namespace import or a default import clause of a static, not type-only
// `import … from` declaration of a runner package. ES imports are immutable bindings and a namespace
// object cannot be reassigned, so the file's own code cannot change what such a name refers to.
// Everything else is uncertain, with its reason, and the rules warn ("may …"), never FAIL: a global
// (jest's, vitest's `globals: true`, mocha's), a local declaration, a parameter, a `require` (even
// one the compiler reads as an alias), `import x = require(…)`, a dynamic import, a merged
// declaration (`namespace assert {}` beside `import assert`), a type-only import. A file the compiler
// rejects (syntax, or the binder's errors on its declarations) is read for nothing: the file gets one
// WARN (src/check.ts).
//
// Aliases: a binding whose value contains a form of the vocabulary makes its name a one-step alias,
// read as that form and never certain: a declaration with an initializer, a destructuring default, a
// parameter default, any assignment operator (`=`, `||=`, `??=`, `+=`…), a destructuring (with a
// literal key, computed or not), `for … of/in`, a class decorator. The first parameter of a test or
// hook callback (vitest's context, node:test's `t`) is an origin too: destructuring it
// (`({ skip: omit })`) or copying it makes an alias of its `skip`. Beyond one step (an alias of an
// alias, a container), the contagion net is the guarantee (src/rules/contagion.ts).
//
// Expressions, subscripts and computed keys are read with parentheses and TypeScript's assertions
// removed: `(it as any).skip`, `it!.skip`, `(<any>it).skip`, `it['skip' as const]`, `{ [('skip')]: x }`
// are `it.skip` / `skip` (src/parse/normalise.ts, one normalisation for every reader).
//
// Mutation is outside the assumption and is not detected. As a courtesy, with no guarantee, an
// evident direct write on an imported runner name (`test.skip = …`, `delete test.skip`,
// `Object.defineProperty(test, …)`, `Object.assign(test, …)`, `Reflect.set(test, …)`) makes its uses
// uncertain.
import ts from 'typescript';
import type { Node } from 'web-tree-sitter';
import { jsMember, jsName, outerTs, tsKey, unwrap } from './normalise.js';
import { tsProgram, type TsProgram } from './ts-program.js';
import type { JestGlobals } from '../config/jest-globals.js';
import { CERTAIN, uncertain, type Binding, type MarkerKind, type ScopeReading } from './types.js';
import { JS_TOKENS } from './vocabulary.js';
import { nameTable } from '../util/names.js';

export type RunnerPackage = 'vitest' | '@jest/globals' | '@playwright/test' | 'node:test';

/** What each runner package exports for its test API, closed and explicit (docs/rules.md, the vocabulary). */
interface RunnerApi {
  /** Exported names that declare a test (`it`, `test`) or a suite (`describe`). */
  tests: ReadonlySet<string>;
  suites: ReadonlySet<string>;
  /** Exported names that are a marker themselves (`fit`, `xit`, …). */
  rootMarkers: ReadonlySet<string>;
  /** Marker modifiers of a test (`it.skip`) and of a suite (`describe.only`); Playwright's suite is `test.describe`. */
  testMarkers: ReadonlySet<string>;
  suiteMarkers: ReadonlySet<string>;
  /** `test.skip()` / `test.fixme()` / `test.fail()` written inside a test, a describe or the file. */
  annotations: ReadonlySet<string>;
  /** Marker keys of a test's options object: `it('x', { skip: true }, fn)`. */
  options: ReadonlySet<string>;
  /** Hooks whose inline callback is part of the block (`beforeEach(() => …)`). */
  hooks: ReadonlySet<string>;
  /** Members of the vocabulary on the first parameter of a test or hook callback (vitest's `ctx.skip()`, node:test's `t.skip()`, `t.todo()`, `t.runOnly()`). */
  context: ReadonlySet<string>;
  /** Focus markers that apply only with a command-line option the code does not show. */
  focusNeedsFlag: string | null;
}

const set = (...xs: string[]): ReadonlySet<string> => new Set(xs);
const NONE = set();

export const RUNNER_API: Record<RunnerPackage, RunnerApi> = {
  vitest: {
    tests: set('it', 'test'),
    suites: set('describe', 'suite'),
    rootMarkers: NONE,
    testMarkers: set('skip', 'only', 'todo', 'fails', 'skipIf', 'runIf'),
    suiteMarkers: set('skip', 'only', 'todo', 'skipIf', 'runIf'),
    annotations: NONE,
    options: set('skip', 'only', 'todo', 'fails'),
    hooks: set('beforeEach', 'beforeAll', 'afterEach', 'afterAll'),
    context: set('skip'),
    focusNeedsFlag: null,
  },
  '@jest/globals': {
    tests: set('it', 'test'),
    suites: set('describe'),
    rootMarkers: set('fit', 'fdescribe', 'xit', 'xtest', 'xdescribe'),
    testMarkers: set('skip', 'only', 'todo', 'failing'),
    suiteMarkers: set('skip', 'only'),
    annotations: NONE,
    options: NONE,
    hooks: set('beforeEach', 'beforeAll', 'afterEach', 'afterAll'),
    context: NONE,
    focusNeedsFlag: null,
  },
  '@playwright/test': {
    tests: set('test'),
    suites: NONE, // `test.describe`
    rootMarkers: NONE,
    testMarkers: set('skip', 'only', 'fixme', 'fail'),
    suiteMarkers: set('skip', 'only', 'fixme'),
    annotations: set('skip', 'fixme', 'fail'),
    options: NONE,
    hooks: set('beforeEach', 'beforeAll', 'afterEach', 'afterAll'),
    context: NONE,
    focusNeedsFlag: null,
  },
  'node:test': {
    tests: set('it', 'test'),
    suites: set('describe', 'suite'),
    rootMarkers: NONE,
    testMarkers: set('skip', 'only', 'todo'),
    suiteMarkers: set('skip', 'only', 'todo'),
    annotations: NONE,
    options: set('skip', 'only', 'todo'),
    hooks: set('before', 'after', 'beforeEach', 'afterEach'),
    context: set('skip', 'todo', 'runOnly'),
    focusNeedsFlag: '--test-only',
  },
};

const RUNNER_PACKAGES = new Set<string>(Object.keys(RUNNER_API));

/** The members of the vocabulary on any runner's test context (`skip`, `todo`), and the kind of marker each is. */
export const JS_CONTEXT_MEMBERS: Readonly<Record<string, MarkerKind>> = nameTable(
  'CONTEXT_MEMBERS',
  Object.fromEntries(Object.values(RUNNER_API).flatMap((api) => [...api.context]).map((m) => [m, JS_TOKENS[m]!])),
);
const isRunnerPackage = (m: string): m is RunnerPackage => RUNNER_PACKAGES.has(m);

/**
 * Assertion roots and where they are certain (TG004): a named import of the name from a runner or
 * an assertion library, or (node:assert, sinon) its default or namespace import under any name.
 */
const ASSERTION_NAMED: Record<string, ReadonlySet<string>> = nameTable('ASSERTION_NAMED', {
  expect: set('vitest', '@jest/globals', '@playwright/test', 'chai'),
  assert: set('vitest', 'chai', 'node:assert', 'assert', 'node:assert/strict', 'assert/strict'),
  expectTypeOf: set('vitest'),
  assertType: set('vitest'),
});
const ASSERTION_MODULES = set('node:assert', 'assert', 'node:assert/strict', 'assert/strict', 'sinon', 'chai');

const line = (n: Node): number => n.startPosition.row + 1;

/** How a name is bound where it is used, before the test API reads it. */
export type RootBinding =
  /** `via: 'global'`: Jest's global of that name, in a file whose invocation and configuration are certified. */
  | { kind: 'import'; pkg: RunnerPackage; imported: string; via?: 'global' }
  | { kind: 'namespace'; pkg: RunnerPackage }
  | { kind: 'uncertain'; why: string };

/**
 * A binding that gives a name a value the alias rules read: the value (a tree-sitter node), the line
 * of the binding, whether the value is exactly what the name holds, and, for `const { skip: omit } =
 * it`, the member of the value the name is taken from.
 */
export interface TsAlias {
  value: Node;
  line: number;
  exact: boolean;
  member?: { name: string; node: Node };
}

/** What a name in a test callback is relative to the callback's context parameter. */
export type ContextRole =
  | { role: 'object' }
  /** A member of the vocabulary destructured from the context (`({ skip: omit }) => …`): a one-step alias, never certain. */
  | { role: 'member-fn'; member: string; alias: string }
  | { why: string };

/** `Object.defineProperty(x, …)` and the like: calls that write on their first argument. */
/** Jest's globals that are its test API (the same functions `@jest/globals` exports): tests, suites, markers, hooks. */
const JEST_GLOBAL_NAMES: ReadonlySet<string> = (() => {
  const api = RUNNER_API['@jest/globals'];
  return new Set([...api.tests, ...api.suites, ...api.rootMarkers, ...api.hooks]);
})();

/** The global object's names: a member write on one writes a global. */
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'global', 'window', 'self']);

const WRITING_CALLS = new Set(['Object.defineProperty', 'Object.defineProperties', 'Object.assign', 'Object.setPrototypeOf', 'Reflect.set', 'Reflect.defineProperty', 'Reflect.deleteProperty', 'Reflect.setPrototypeOf']);

/** The identifier at the root of `a.b['c'].d`, or null when the root is anything else. */
function rootOf(node: Node | null): Node | null {
  let n = node ? unwrap(node) : null;
  while (n && (n.type === 'member_expression' || n.type === 'subscript_expression')) {
    const object = n.childForFieldName('object');
    n = object ? unwrap(object) : null;
  }
  return n?.type === 'identifier' ? n : null;
}

/** A value a binding gives a name, as TypeScript nodes (see TsAlias). */
interface Written {
  value: ts.Node;
  at: ts.Node;
  exact: boolean;
  member?: { name: string; key: ts.Node };
}

interface ModuleImport {
  module: string;
  /** The exported name (`it` in `import { it as check }`); 'default'; null for a namespace import. */
  imported: string | null;
  typeOnly: boolean;
  symbol: ts.Symbol;
}

/**
 * Every kind of declaration the compiler can give a symbol (ts.isDeclaration, and the JavaScript
 * expando forms), and what the alias rules read in it: `import` (the runner question), `value` (an
 * initializer, a default, the iterable of a `for`, a decorator, an import alias's reference), or
 * `none` (it gives no name a value an expression could alias). test/ts-exhaustive.test.ts holds the
 * map to the compiler's SyntaxKind list; a kind the map does not know is read as unknown (WARN).
 */
export const TS_DECLARATIONS: Readonly<Record<string, 'import' | 'value' | 'none'>> = nameTable('TS_DECLARATIONS', {
  ImportClause: 'import',
  NamespaceImport: 'import',
  ImportSpecifier: 'import',
  VariableDeclaration: 'value',
  Parameter: 'value',
  BindingElement: 'value',
  ClassDeclaration: 'value',
  ClassExpression: 'value',
  ImportEqualsDeclaration: 'value',
  FunctionDeclaration: 'none',
  FunctionExpression: 'none',
  ArrowFunction: 'none',
  EnumDeclaration: 'none',
  ModuleDeclaration: 'none',
  TypeParameter: 'none',
  PropertySignature: 'none',
  PropertyDeclaration: 'none',
  MethodSignature: 'none',
  MethodDeclaration: 'none',
  ClassStaticBlockDeclaration: 'none',
  Constructor: 'none',
  GetAccessor: 'none',
  SetAccessor: 'none',
  NamedTupleMember: 'none',
  InterfaceDeclaration: 'none',
  TypeAliasDeclaration: 'none',
  NamespaceExportDeclaration: 'none',
  NamespaceExport: 'none',
  ExportSpecifier: 'none',
  ExportAssignment: 'none',
  JsxAttribute: 'none',
  PropertyAssignment: 'none',
  ShorthandPropertyAssignment: 'none',
  EnumMember: 'none',
  JSDocCallbackTag: 'none',
  JSDocTypedefTag: 'none',
  JSDocPropertyTag: 'none',
  JSDocParameterTag: 'none',
  JSDocEnumTag: 'none',
  BinaryExpression: 'none',
  PropertyAccessExpression: 'none',
  ElementAccessExpression: 'none',
  CallExpression: 'none',
  SourceFile: 'none',
  MissingDeclaration: 'none',
});

/** The assignment operators whose result is the right-hand value itself (`=`, `||=`, `&&=`, `??=`); the others compute one from it. */
const EXACT_ASSIGNMENTS = new Set([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken]);
export const isAssignmentOperator = (k: ts.SyntaxKind): boolean => k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
export { EXACT_ASSIGNMENTS };

const kindName = (n: ts.Node): string => ts.SyntaxKind[n.kind];

/** How a message names a declaration, in words a reader knows (never the compiler's kind names: `BindingElement`). */
function declaredAs(n: ts.Node): string {
  if (ts.isBindingElement(n)) return 'by destructuring';
  if (ts.isVariableDeclaration(n)) return 'as a variable';
  if (ts.isParameter(n)) return 'as a parameter';
  if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) return 'as a function';
  if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) return 'as a class';
  if (ts.isImportEqualsDeclaration(n)) return 'by `import … = require(…)`';
  if (ts.isEnumDeclaration(n)) return 'as an enum';
  if (ts.isModuleDeclaration(n)) return 'as a namespace';
  return `as a ${kindName(n).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`;
}

/** `++x`, `x--`: a write of x with no value an alias could hold. */
const isIncrement = (n: ts.Node | undefined): boolean =>
  n !== undefined && (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken);

/** A program's identifiers by name and by start, and the answers asked of them, computed once per program. */
interface ProgramIndex {
  byName: Map<string, ts.Identifier[]>;
  byStart: Map<number, ts.Identifier>;
  references: Map<ts.Symbol, ts.Identifier[]>;
  values: Map<ts.Symbol, Written[]>;
}

const indexes = new WeakMap<TsProgram, ProgramIndex>();

function indexOf(program: TsProgram): ProgramIndex {
  let index = indexes.get(program);
  if (!index) {
    const sf = program.file;
    index = { byName: new Map(), byStart: new Map(), references: new Map(), values: new Map() };
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        const list = index!.byName.get(n.text);
        if (list) list.push(n);
        else index!.byName.set(n.text, [n]);
        index!.byStart.set(n.getStart(sf), n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    indexes.set(program, index);
  }
  return index;
}

export class TsResolver {
  private readonly program: TsProgram;
  private readonly mutated = new Map<ts.Symbol, Node>();
  /** The program's identifiers and what has been asked of them (shared by every parse of the same content). */
  private readonly index: ProgramIndex;

  /** Names the file writes as globals (`it = …`, `globalThis.it = …`), or 'all' (`Object.assign(globalThis, …)`): courtesy. */
  private readonly globalWrites = new Map<string, Node>();
  private globalWritesAll: Node | null = null;

  constructor(
    private readonly tree: Node,
    source: string,
    path: string,
    /** Whether Jest's globals are Jest's in this file (src/config/jest-globals.ts); null: never. */
    private readonly jestGlobals: JestGlobals | null = null,
  ) {
    this.program = tsProgram(source, path);
    this.index = indexOf(this.program);
    if (this.program.issue === null) {
      this.findWrites();
      this.findGlobalWrites();
    }
  }

  /**
   * Writes to a global name the file makes itself (a courtesy, with no guarantee: anything else that redefines a global is
   * mutation, outside the assumption): an assignment of any operator, an update or a destructuring whose target is a
   * bare name the compiler binds to nothing; a member write, `delete` or by-name primitive on `globalThis`, `global`,
   * `window` or `self` with that key; and any `Object.assign`/`defineProperties`-like call on those receivers (all names).
   */
  private findGlobalWrites(): void {
    const unbound = (n: Node): boolean => n.type === 'identifier' && this.identifierAt(n) !== null && this.symbolAt(n) === undefined;
    const add = (name: string, at: Node): void => {
      if (!this.globalWrites.has(name)) this.globalWrites.set(name, at);
    };
    const patternNames = (p: Node, at: Node): void => {
      for (const id of [p, ...p.descendantsOfType(['identifier', 'shorthand_property_identifier_pattern'])]) {
        if (id.type === 'identifier' && unbound(id)) add(id.text, at);
        if (id.type === 'shorthand_property_identifier_pattern') add(id.text, at);
      }
    };
    for (const n of this.tree.descendantsOfType(['assignment_expression', 'augmented_assignment_expression', 'update_expression', 'unary_expression', 'call_expression'])) {
      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression' || n.type === 'update_expression') {
        const target = n.childForFieldName(n.type === 'update_expression' ? 'argument' : 'left');
        if (!target) continue;
        const t = unwrap(target);
        if (t.type === 'object_pattern' || t.type === 'array_pattern') patternNames(t, n);
        else if (unbound(t)) add(t.text, n);
        else {
          const m = jsMember(t);
          if (m && m.object.type === 'identifier' && GLOBAL_OBJECTS.has(jsName(m.object))) add(m.name, n);
        }
      } else if (n.type === 'unary_expression') {
        if (n.childForFieldName('operator')?.type !== 'delete') continue;
        const arg = n.childForFieldName('argument');
        const m = arg ? jsMember(unwrap(arg)) : null;
        if (m && m.object.type === 'identifier' && GLOBAL_OBJECTS.has(jsName(m.object))) add(m.name, n);
      } else {
        const fn = n.childForFieldName('function');
        const member = fn ? jsMember(unwrap(fn)) : null;
        if (!member || member.object.type !== 'identifier' || !WRITING_CALLS.has(`${jsName(member.object)}.${member.name}`)) continue;
        const first = n.childForFieldName('arguments')?.namedChildren.find((c) => c.type !== 'comment') ?? null;
        if (first && unwrap(first).type === 'identifier' && GLOBAL_OBJECTS.has(jsName(unwrap(first)))) this.globalWritesAll ??= n;
      }
    }
  }

  /** Whether the compiler read the file's names. */
  get scopes(): ScopeReading {
    return this.program.issue === null ? { known: true } : { known: false, why: this.program.issue };
  }

  /** The TypeScript node of one of `test`'s kinds that spans exactly [start, end), or null. */
  private tsNodeAt<T extends ts.Node>(start: number, end: number, test: (n: ts.Node) => n is T): T | null {
    const sf = this.program.file;
    let found: T | null = null;
    const visit = (n: ts.Node): void => {
      if (found) return;
      const s = n.getStart(sf);
      if (s > start || n.end < end) return;
      if (s === start && n.end === end && test(n)) found = n;
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(sf, visit);
    return found;
  }

  /** The tree-sitter node that spans a TypeScript node exactly (the innermost), or null. */
  private treeNode(n: ts.Node): Node | null {
    const start = n.getStart(this.program.file);
    const end = n.end;
    if (end <= start) return null;
    for (let t: Node | null = this.tree.descendantForIndex(start, end - 1); t; t = t.parent) {
      if (t.startIndex < start || t.endIndex > end) return null;
      if (t.startIndex === start && t.endIndex === end) return t;
    }
    return null;
  }

  private identifierAt(use: Node): ts.Identifier | null {
    const id = this.index.byStart.get(use.startIndex);
    return id && id.end === use.endIndex ? id : null;
  }

  /** The local symbol of the name at `use`, as the compiler resolves it. */
  private symbolAt(use: Node): ts.Symbol | undefined {
    const id = this.identifierAt(use);
    if (!id) return undefined;
    // `{ it }` in an object literal: the variable it reads, not the property it creates.
    if (ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id) return this.program.checker.getShorthandAssignmentValueSymbol(id.parent);
    return this.program.checker.getSymbolAtLocation(id);
  }

  /** The import a symbol is, or why it is not one of a static, value import declaration. */
  private importOf(symbol: ts.Symbol | undefined, name: string): ModuleImport | { why: string } {
    if (!symbol) return { why: `\`${name}\` is a global, not imported from a runner` };
    const decls = symbol.declarations ?? [];
    const sf = this.program.file;
    const at = (d: ts.Node): number => sf.getLineAndCharacterOfPosition(d.getStart(sf)).line + 1;
    if (decls.length === 0) return { why: `\`${name}\` is bound implicitly (\`${name}\` of a function, or the module's), not imported from a runner` };
    if (decls.length > 1) return { why: `\`${name}\` has ${decls.length} declarations (lines ${decls.map(at).join(', ')}), merged by the compiler` };
    const d = decls[0]!;
    let clause: ts.ImportClause;
    let imported: string | null;
    let typeOnly = false;
    if (ts.isImportSpecifier(d)) {
      clause = d.parent.parent;
      imported = (d.propertyName ?? d.name).text;
      typeOnly = d.isTypeOnly;
    } else if (ts.isNamespaceImport(d)) {
      clause = d.parent;
      imported = null;
    } else if (ts.isImportClause(d)) {
      clause = d;
      imported = 'default';
    } else {
      return { why: `\`${name}\` is declared at line ${at(d)} ${declaredAs(d)}, not imported from a runner` };
    }
    const decl = clause.parent;
    if (!ts.isImportDeclaration(decl)) return { why: `\`${name}\` is imported ${declaredAs(decl)}, not by a static import declaration` };
    if (!ts.isStringLiteral(decl.moduleSpecifier)) return { why: `\`${name}\` is imported from a computed module` };
    return { module: decl.moduleSpecifier.text, imported, typeOnly: typeOnly || clause.isTypeOnly, symbol };
  }

  /** Courtesy: writes on the members of an imported name (see the header). */
  private findWrites(): void {
    const roots: Array<{ root: Node | null; at: Node }> = [];
    for (const n of this.tree.descendantsOfType(['assignment_expression', 'augmented_assignment_expression', 'unary_expression', 'call_expression', 'update_expression'])) {
      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
        const left = n.childForFieldName('left');
        if (left && unwrap(left).type !== 'identifier') roots.push({ root: rootOf(left), at: n });
      } else if (n.type === 'unary_expression') {
        if (n.childForFieldName('operator')?.type === 'delete') roots.push({ root: rootOf(n.childForFieldName('argument')), at: n });
      } else if (n.type === 'update_expression') {
        const arg = n.childForFieldName('argument');
        if (arg && unwrap(arg).type !== 'identifier') roots.push({ root: rootOf(arg), at: n });
      } else {
        const fn = n.childForFieldName('function');
        const member = fn ? jsMember(unwrap(fn)) : null;
        if (member?.object.type === 'identifier' && WRITING_CALLS.has(`${jsName(member.object)}.${member.name}`)) {
          const first = n.childForFieldName('arguments')?.namedChildren.find((c) => c.type !== 'comment') ?? null;
          roots.push({ root: rootOf(first), at: n });
        }
      }
    }
    for (const { root, at } of roots) {
      if (!root) continue;
      const symbol = this.symbolAt(root);
      if (symbol && !this.mutated.has(symbol)) this.mutated.set(symbol, at);
    }
  }

  /**
   * Why an import is not certain because the file writes on it (courtesy): on its members, or on the
   * name itself (`it = other`, which an ES module refuses at run time); or null.
   */
  private written(name: string, imp: ModuleImport): string | null {
    const self = this.references(imp.symbol).find((r) => this.writeValues(r).length > 0 || isIncrement(outerTs(r).parent));
    if (self) {
      const sf = this.program.file;
      return `the file assigns to the import \`${name}\` (line ${sf.getLineAndCharacterOfPosition(self.getStart(sf)).line + 1}): outside the assumption, it may not be ${imp.module}'s`;
    }
    const at = this.mutated.get(imp.symbol);
    if (!at) return null;
    const text = at.text.split('\n')[0]!.slice(0, 60);
    return `the file writes to \`${name}\`'s members (\`${text}\`, line ${line(at)}): outside the assumption, it may not be ${imp.module}'s`;
  }

  private moduleImport(use: Node): ModuleImport | { why: string } {
    if (this.program.issue !== null) return { why: this.program.issue };
    const name = jsName(use);
    if (!this.identifierAt(use)) return { why: `the compiler does not read \`${name}\` as a name here` };
    return this.importOf(this.symbolAt(use), name);
  }

  /** Where the identifier at the root of a callee comes from (see the header). */
  root(use: Node): RootBinding {
    const name = jsName(use);
    const global = this.globalRoot(use, name);
    if (global) return global;
    const imp = this.moduleImport(use);
    if ('why' in imp) return { kind: 'uncertain', why: imp.why };
    if (!isRunnerPackage(imp.module)) return { kind: 'uncertain', why: `\`${name}\` is imported from '${imp.module}', not from a runner` };
    if (imp.typeOnly) return { kind: 'uncertain', why: `\`${name}\` is a type-only import` };
    if (imp.imported === 'default') return { kind: 'uncertain', why: `\`${name}\` is the default import of '${imp.module}', not a named or namespace import` };
    const write = this.written(name, imp);
    if (write) return { kind: 'uncertain', why: write };
    if (imp.imported === null) return { kind: 'namespace', pkg: imp.module };
    return { kind: 'import', pkg: imp.module, imported: imp.imported };
  }

  /**
   * A name the compiler binds to nothing in the file, at an occurrence it reads (its health checked): Jest's global of
   * that name when the file's invocation and configuration are certified (src/config/jest-globals.ts) and the file does
   * not write that global itself; otherwise uncertain, saying which. Null when the name is bound in the file.
   */
  private globalRoot(use: Node, name: string): RootBinding | null {
    if (this.program.issue !== null || use.type !== 'identifier' || !this.identifierAt(use) || this.symbolAt(use) !== undefined) return null;
    const g = this.jestGlobals;
    if (!g) return { kind: 'uncertain', why: `\`${name}\` is a global, and no Jest invocation saidvsdid can read runs this file` };
    if (!g.certified) return { kind: 'uncertain', why: `\`${name}\` is a global, and ${g.why}` };
    if (!JEST_GLOBAL_NAMES.has(name)) return { kind: 'uncertain', why: `\`${name}\` is a global, not one of Jest's` };
    const write = this.globalWrites.get(name) ?? this.globalWritesAll;
    if (write) return { kind: 'uncertain', why: `the file writes Jest's global \`${name}\` (line ${line(write)}): outside the assumption, it may not be Jest's` };
    return { kind: 'import', pkg: '@jest/globals', imported: name, via: 'global' };
  }

  /** TG004: the root of an assertion (`expect` in `expect(x).toBe(1)`, `assert`, `sinon` in `sinon.assert.x`). */
  assertionRoot(use: Node): Binding {
    const name = jsName(use);
    const imp = this.moduleImport(use);
    if ('why' in imp) return uncertain(imp.why);
    if (imp.typeOnly) return uncertain(`\`${name}\` is a type-only import`);
    const write = this.written(name, imp);
    if (write) return uncertain(write);
    const not = uncertain(`\`${name}\` is imported from '${imp.module}', not from a runner or an assertion library`);
    if (imp.imported === null || imp.imported === 'default') return ASSERTION_MODULES.has(imp.module) ? CERTAIN : not;
    // `import { strict as assert } from 'node:assert'`.
    if (imp.imported === 'strict' && name === 'assert') return ASSERTION_NAMED.assert!.has(imp.module) && imp.module !== 'vitest' && imp.module !== 'chai' ? CERTAIN : not;
    return ASSERTION_NAMED[imp.imported]?.has(imp.module) && imp.imported === name ? CERTAIN : not;
  }

  /** The identifiers of the file that the compiler resolves to `symbol`. */
  private references(symbol: ts.Symbol): ts.Identifier[] {
    let refs = this.index.references.get(symbol);
    if (!refs) {
      const checker = this.program.checker;
      refs = (this.index.byName.get(symbol.name) ?? []).filter((id) => {
        const s = ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id ? checker.getShorthandAssignmentValueSymbol(id.parent) : checker.getSymbolAtLocation(id);
        return s === symbol;
      });
      this.index.references.set(symbol, refs);
    }
    return refs;
  }

  /** The values a declaration gives its name (TS_DECLARATIONS), as TypeScript nodes. */
  private declarationValues(d: ts.Node, out: Written[]): void {
    const kind = TS_DECLARATIONS[kindName(d)];
    if (kind === 'import' || kind === 'none') return;
    if (kind === undefined) {
      // A declaration the map does not know: everything in it may be the name's value.
      out.push({ value: d, at: d, exact: false });
      return;
    }
    if (ts.isVariableDeclaration(d) || ts.isParameter(d)) {
      if (d.initializer) out.push({ value: d.initializer, at: d, exact: ts.isIdentifier(d.name) });
      const loop = ts.isVariableDeclaration(d) ? d.parent?.parent : undefined;
      if (loop && (ts.isForOfStatement(loop) || ts.isForInStatement(loop))) out.push({ value: loop.expression, at: d, exact: false });
      return;
    }
    if (ts.isBindingElement(d)) {
      // `{ omit = it.skip }`: the default.
      if (d.initializer) out.push({ value: d.initializer, at: d, exact: true });
      // `{ skip: omit } = it`: the member of what the pattern destructures.
      const pattern = d.parent;
      const holder = pattern.parent;
      const key = ts.isObjectBindingPattern(pattern) ? tsKey(d.propertyName ?? (ts.isIdentifier(d.name) ? d.name : undefined)) : null;
      const sources: ts.Node[] = [];
      if ((ts.isVariableDeclaration(holder) || ts.isParameter(holder)) && holder.initializer) sources.push(holder.initializer);
      const loop = ts.isVariableDeclaration(holder) ? holder.parent?.parent : undefined;
      if (loop && (ts.isForOfStatement(loop) || ts.isForInStatement(loop))) sources.push(loop.expression);
      for (const source of sources) {
        const direct = source === (holder as ts.VariableDeclaration).initializer;
        if (direct && key !== null) out.push({ value: source, at: d, exact: true, member: { name: key, key: d.propertyName ?? d.name } });
        else out.push({ value: source, at: d, exact: false });
      }
      // Deeper in a pattern (`{ a: { skip: omit } } = x`), or under a computed key: what the outermost pattern takes apart.
      if (ts.isBindingElement(holder)) {
        let top: ts.Node = holder;
        while (ts.isBindingElement(top) || ts.isObjectBindingPattern(top) || ts.isArrayBindingPattern(top)) top = top.parent;
        if ((ts.isVariableDeclaration(top) || ts.isParameter(top)) && top.initializer) out.push({ value: top.initializer, at: d, exact: false });
      }
      return;
    }
    if (ts.isClassDeclaration(d) || ts.isClassExpression(d)) {
      for (const m of ts.getDecorators(d) ?? []) out.push({ value: m.expression, at: d, exact: false });
      return;
    }
    if (ts.isImportEqualsDeclaration(d)) out.push({ value: d.moduleReference, at: d, exact: true });
  }

  /**
   * The values a write of `id` gives it: `x = v` (any assignment operator), `x ||= v`, a destructuring
   * assignment (`({ k: x } = v)`, `[x] = v`, with its defaults `{ x = d }`), `for (x of v)`. None when
   * `id` is not written there.
   */
  private writeValues(id: ts.Identifier): Written[] {
    const out: Written[] = [];
    let n: ts.Node = outerTs(id);
    // The literal keys from the outermost pattern down to the name; null once one is not literal (an array, a spread).
    let keys: Array<{ name: string; key: ts.Node }> | null = [];
    let inPattern = false;
    for (;;) {
      const p = n.parent;
      if (!p) return out;
      if (ts.isBinaryExpression(p) && p.left === n && isAssignmentOperator(p.operatorToken.kind)) {
        if (!inPattern) {
          // `x = v`, `x ||= v`, or a default `x = d` inside a pattern (climbed further below).
          out.push({ value: p.right, at: p, exact: EXACT_ASSIGNMENTS.has(p.operatorToken.kind) });
          if (p.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return out;
          n = outerTs(p);
          continue;
        }
        // The top of a destructuring assignment.
        const member = keys !== null && keys.length === 1 ? keys[0] : undefined;
        out.push(member ? { value: p.right, at: p, exact: true, member } : { value: p.right, at: p, exact: false });
        return out;
      }
      if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === n) {
        out.push({ value: p.expression, at: p, exact: false });
        return out;
      }
      if (ts.isShorthandPropertyAssignment(p) && p.name === n) {
        if (p.objectAssignmentInitializer) out.push({ value: p.objectAssignmentInitializer, at: p, exact: true });
        keys?.unshift({ name: p.name.text, key: p.name });
        inPattern = true;
        n = outerTs(p.parent);
        continue;
      }
      if (ts.isPropertyAssignment(p) && p.initializer === n) {
        const key = tsKey(p.name);
        if (key === null) keys = null;
        else keys?.unshift({ name: key, key: p.name });
        inPattern = true;
        n = outerTs(p.parent);
        continue;
      }
      if (ts.isArrayLiteralExpression(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p)) {
        keys = null;
        inPattern = true;
        n = outerTs(ts.isArrayLiteralExpression(p) ? p : p.parent);
        continue;
      }
      // Anything else: `n` is not (part of) an assignment target.
      return inPattern ? [] : out;
    }
  }

  /**
   * The one-step aliases of the name used at `use` (see the header): every value a declaration or a
   * write of its symbol gives it, as tree-sitter nodes.
   */
  aliasOf(use: Node): TsAlias[] {
    if (this.program.issue !== null) return [];
    const symbol = this.symbolAt(use);
    if (!symbol) return [];
    let found = this.index.values.get(symbol);
    if (!found) {
      found = [];
      for (const d of symbol.declarations ?? []) this.declarationValues(d, found);
      for (const ref of this.references(symbol)) found.push(...this.writeValues(ref));
      this.index.values.set(symbol, found);
    }
    const sf = this.program.file;
    const out: TsAlias[] = [];
    for (const f of found) {
      const value = this.treeNode(f.value);
      if (!value) continue;
      const key = f.member ? this.treeNode(f.member.key) : null;
      out.push({
        value: unwrap(value),
        line: sf.getLineAndCharacterOfPosition(f.at.getStart(sf)).line + 1,
        exact: f.exact,
        ...(f.member ? { member: { name: f.member.name, node: key ?? use } } : {}),
      });
    }
    return out;
  }

  /**
   * What the name used at `use` is relative to the context parameter of the callback `fn` (the
   * first parameter of a test or hook callback): the parameter itself, its `skip` destructured in the
   * parameter list (`({ skip: omit }) => …`, a one-step alias), or something else. Every other alias
   * of the context (`const c = ctx`, `omit ||= t.skip.bind(t)`) is read by the one alias reading
   * (src/parse/ts.ts, aliasForms) from the values aliasOf gives.
   */
  contextRole(use: Node, fn: Node): ContextRole {
    const name = jsName(use);
    const not = { why: `\`${name}\` is not the context parameter of the test's callback` };
    if (this.program.issue !== null) return { why: this.program.issue };
    const callback = this.tsNodeAt(fn.startIndex, fn.endIndex, ts.isFunctionLike);
    const param = callback?.parameters[0];
    const symbol = this.symbolAt(use);
    if (!param || !symbol) return not;
    const decls = symbol.declarations ?? [];
    if (decls.length !== 1) return not;
    const d = decls[0]!;
    const sf = this.program.file;
    const at = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const writes = this.references(symbol).filter((r) => this.writeValues(r).length > 0 || isIncrement(outerTs(r).parent));
    if (d === param && ts.isIdentifier(param.name)) {
      return writes.length ? { why: `\`${name}\` is reassigned in the callback (line ${at(writes[0]!)})` } : { role: 'object' };
    }
    // `({ skip: omit }) => …`, `({ skip }) => …`: destructuring the context.
    if (ts.isBindingElement(d) && d.parent.parent === param && ts.isObjectBindingPattern(d.parent)) {
      const key = tsKey(d.propertyName ?? (ts.isIdentifier(d.name) ? d.name : undefined));
      if (key != null && Object.hasOwn(JS_CONTEXT_MEMBERS, key)) return { role: 'member-fn', member: key, alias: `\`${name}\` is the test context's \`${key}\`, destructured (line ${at(d)}): a one-step alias` };
      return not;
    }
    return not;
  }
}

export { isRunnerPackage };
