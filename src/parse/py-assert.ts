// Assertions and assertion-capable calls in pytest / unittest test bodies (TG004).
//
// Assertions: the `assert` statement, `self.assertX(...)` and any other
// `assert*` call (mock `assert_called_with`, `np.testing.assert_allclose`),
// `self.fail(...)`, `pytest.raises(...)` / `pytest.warns(...)`.
//
// Calls that may assert on the test's behalf: same-file functions and methods
// of the test class that (transitively) assert or call something unknown,
// anything imported from a test-support module (`tests.helpers`, `conftest`,
// `.support`), assertion-like names, fixtures (parameters) called as
// functions, `self.x()` not defined in the file, and unresolved names.
//
// Each assertion carries its Binding (src/parse/py-binding.ts): the `assert`
// statement is the language's; `pytest.raises()` is certain through a
// module-level import of pytest that nothing in the module rebinds;
// `self.assertX()` / `self.fail()` only through unittest.TestCase with no
// override in the file (case B); a mock's `assert_called_with()` is the
// mock's: uncertain.
import type { Node } from 'web-tree-sitter';
import { normaliseBody } from './conditions.js';
import { outerWrap, pyName, unwrap } from './normalise.js';
import { PyResolver } from './py-binding.js';
import type { PyFacts } from './py-scopes.js';
import { ASSERTION_LIKE, TEST_SUPPORT_MODULE } from './ts-assert.js';
import { CERTAIN, uncertain, type Assertion } from './types.js';

const line = (n: Node): number => n.startPosition.row + 1;

/** A dotted name as Python reads it (NFKC, parentheses removed); null for anything else. */
function dotted(expr: Node): string[] | null {
  const node = unwrap(expr);
  if (node.type === 'identifier') return [pyName(node)];
  if (node.type === 'attribute') {
    const object = node.childForFieldName('object');
    const attr = node.childForFieldName('attribute');
    const base = object ? dotted(object) : null;
    return base && attr ? [...base, pyName(attr)] : null;
  }
  return null;
}

function positional(call: Node): Node[] {
  return (call.childForFieldName('arguments')?.namedChildren ?? []).filter((a) => a.type !== 'keyword_argument' && a.type !== 'comment');
}

function keyword(call: Node, name: string): Node | null {
  for (const a of call.childForFieldName('arguments')?.namedChildren ?? []) {
    const k = a.type === 'keyword_argument' ? a.childForFieldName('name') : null;
    if (k && pyName(k) === name) return a.childForFieldName('value');
  }
  return null;
}

function numberValue(node: Node | null | undefined): number | null {
  if (!node) return null;
  if (node.type === 'integer' || node.type === 'float') {
    const v = Number(node.text.replace(/_/g, ''));
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/** `pytest.approx(x, rel=..., abs=...)` / `approx(x, 1e-3)`: literal tolerances. */
function approxOf(node: Node): Assertion['approx'] | undefined {
  if (node.type !== 'call') return undefined;
  const name = dotted(node.childForFieldName('function')!);
  if (name?.[name.length - 1] !== 'approx') return undefined;
  const pos = positional(node);
  const rel = keyword(node, 'rel') ?? pos[1] ?? null;
  const abs = keyword(node, 'abs') ?? pos[2] ?? null;
  // A tolerance that is given but not a literal cannot be compared.
  if ((rel && numberValue(rel) === null) || (abs && numberValue(abs) === null)) return undefined;
  return { rel: numberValue(rel), abs: numberValue(abs) };
}

const norm = (n: Node): string => normaliseBody(n.text);

/** `assert <condition>`: subject and matcher from the shape of the condition. */
function assertStatement(stmt: Node): Assertion | null {
  const cond = stmt.namedChildren[0];
  if (!cond) return null;
  const base = { line: line(stmt), text: norm(stmt), binding: CERTAIN };
  if (cond.type === 'comparison_operator') {
    const parts = cond.namedChildren;
    const left = parts[0]!;
    const right = parts[parts.length - 1]!;
    if (parts.length === 2) {
      const op = cond.text.slice(left.endIndex - cond.startIndex, right.startIndex - cond.startIndex).trim().replace(/\s+/g, ' ');
      const isNone = right.type === 'none';
      let matcher = op;
      if (isNone && (op === 'is' || op === '==')) matcher = 'is None';
      else if (isNone && (op === 'is not' || op === '!=')) matcher = 'is not None';
      const approx = op === '==' ? approxOf(right) : undefined;
      return { ...base, subject: norm(left), matcher: approx ? '== approx' : matcher, ...(approx ? { approx } : {}) };
    }
    return { ...base, subject: norm(left), matcher: 'chained comparison' };
  }
  if (cond.type === 'not_operator') {
    const arg = cond.childForFieldName('argument');
    return { ...base, subject: arg ? norm(arg) : null, matcher: 'falsy' };
  }
  if (cond.type === 'call') {
    const name = dotted(cond.childForFieldName('function')!);
    const first = positional(cond)[0];
    if (name?.join('.') === 'isinstance' && first) return { ...base, subject: norm(first), matcher: 'isinstance' };
  }
  return { ...base, subject: norm(cond), matcher: 'truthy' };
}

/** Mock assertions name the mock as their subject, not their first argument. */
const MOCK_ASSERT = /^assert_(?:called|not_called|any_call|has_calls|awaited|not_awaited|any_await|has_awaits)/;

function assertionCall(call: Node, resolver: PyResolver): Assertion | null {
  const fnNode = call.childForFieldName('function');
  const name = fnNode ? dotted(fnNode) : null;
  if (!name || !fnNode) return null;
  const last = name[name.length - 1]!;
  const joined = name.join('.');
  const self = name[0] === 'self' && name.length === 2 ? fnNode.childForFieldName('object') : null;
  const resolved = self ? null : resolver.dotted(fnNode);
  const binding = self ? resolver.selfMethod(self, last) : (resolved?.binding ?? uncertain(`\`${joined}\` is not a dotted name`));
  const base = { line: line(call), text: norm(call) };
  // By binding: `pt.raises` (`import pytest as pt`), `raises` (`from pytest import raises`), a one-step alias.
  const path = resolved?.path.join('.') ?? joined;
  if (path === 'pytest.raises' || path === 'pytest.warns' || joined === 'raises' || joined === 'warns') {
    return { ...base, subject: null, matcher: `pytest.${last}`, binding };
  }
  if (joined === 'self.fail') return { ...base, subject: null, matcher: 'fail', binding };
  if (!/^assert/i.test(last)) return null;
  if (MOCK_ASSERT.test(last) && name.length > 1) return { ...base, subject: name.slice(0, -1).join('.'), matcher: last, binding: self ? binding : uncertain(`\`${joined}\` asserts through \`${name.slice(0, -1).join('.')}\`, not unittest or pytest`) };
  const first = positional(call)[0];
  return { ...base, subject: first ? norm(first) : null, matcher: last, binding: self ? binding : uncertain(`\`${joined}\` is not unittest's or pytest's`) };
}

export function pyAssertions(body: Node, resolver: PyResolver): Assertion[] {
  const out: Assertion[] = [];
  for (const stmt of body.descendantsOfType('assert_statement')) {
    const a = assertStatement(stmt);
    if (a) out.push(a);
  }
  for (const call of body.descendantsOfType('call')) {
    const a = assertionCall(call, resolver);
    if (a) out.push(a);
  }
  return out.sort((x, y) => x.line - y.line || (x.text < y.text ? -1 : 1));
}

// ---------------------------------------------------------------------------

const PY_BUILTINS = new Set([
  'print', 'len', 'str', 'int', 'float', 'bool', 'bytes', 'list', 'dict', 'set', 'frozenset', 'tuple', 'range',
  'sorted', 'reversed', 'sum', 'min', 'max', 'abs', 'round', 'repr', 'isinstance', 'issubclass', 'type', 'open',
  'enumerate', 'zip', 'map', 'filter', 'any', 'all', 'iter', 'next', 'getattr', 'setattr', 'hasattr', 'delattr',
  'format', 'hash', 'id', 'callable', 'super', 'vars', 'dir', 'divmod', 'pow', 'object', 'ord', 'chr', 'hex', 'oct',
  'bin', 'complex', 'bytearray', 'memoryview', 'slice', 'property', 'staticmethod', 'classmethod',
  'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError', 'RuntimeError', 'AttributeError',
  'ZeroDivisionError', 'OSError', 'IOError', 'NotImplementedError', 'StopIteration',
]);

/** unittest.TestCase API that does not assert. */
const TESTCASE_API = new Set(['subTest', 'addCleanup', 'skipTest', 'id', 'shortDescription', 'enterContext', 'doCleanups', 'setUp', 'tearDown', 'run', 'debug']);

export interface PyFileInfo {
  /** Module-level functions by name. */
  functions: Map<string, Node>;
  /** Local binding → imported module (`from tests.helpers import check` → tests.helpers). */
  imports: Map<string, string>;
  memo: Map<number, boolean>;
  /** Where the runner's names come from (src/parse/py-binding.ts). */
  resolver: PyResolver;
}

export function pyFileInfo(root: Node, source: string, facts: PyFacts): PyFileInfo {
  const functions = new Map<string, Node>();
  const imports = new Map<string, string>();
  for (const stmt of root.namedChildren) {
    const def = stmt.type === 'decorated_definition' ? stmt.childForFieldName('definition') : stmt;
    if (def?.type === 'function_definition') {
      const name = def.childForFieldName('name')?.text;
      if (name) functions.set(name, def);
    }
  }
  for (const imp of root.descendantsOfType('import_from_statement')) {
    const module = imp.childForFieldName('module_name')?.text ?? '';
    for (const n of imp.childrenForFieldName('name')) {
      const local = n.type === 'aliased_import' ? n.childForFieldName('alias') : n;
      if (local) imports.set(local.text.split('.').pop()!, module);
    }
  }
  for (const imp of root.descendantsOfType('import_statement')) {
    for (const n of imp.childrenForFieldName('name')) {
      const alias = n.type === 'aliased_import' ? n.childForFieldName('alias') : null;
      const module = (n.type === 'aliased_import' ? n.childForFieldName('name') : n)?.text ?? '';
      imports.set(alias?.text ?? module.split('.')[0]!, module);
    }
  }
  return { functions, imports, memo: new Map(), resolver: new PyResolver(root, source, facts) };
}

function isSupportModule(module: string): boolean {
  return TEST_SUPPORT_MODULE.test(module.replace(/^\.+/, '.'));
}

function methodsOf(cls: Node | null): Map<string, Node> {
  const out = new Map<string, Node>();
  for (const stmt of cls?.childForFieldName('body')?.namedChildren ?? []) {
    const def = stmt.type === 'decorated_definition' ? stmt.childForFieldName('definition') : stmt;
    const name = def?.type === 'function_definition' ? def.childForFieldName('name')?.text : undefined;
    if (name && def) out.set(name, def);
  }
  return out;
}

function mayAssert(fn: Node, info: PyFileInfo, cls: Node | null, visiting: Set<number>): boolean {
  const known = info.memo.get(fn.id);
  if (known !== undefined) return known;
  if (visiting.has(fn.id)) return false;
  visiting.add(fn.id);
  const body = fn.childForFieldName('body');
  const result = body ? pyAssertions(body, info.resolver).length > 0 || mayAssertCalls(body, info, cls, parameterNames(fn), visiting).length > 0 : false;
  visiting.delete(fn.id);
  info.memo.set(fn.id, result);
  return result;
}

function parameterNames(fn: Node): Set<string> {
  const out = new Set<string>();
  for (const p of fn.childForFieldName('parameters')?.namedChildren ?? []) {
    const id = p.type === 'identifier' ? p : (p.childForFieldName('name') ?? p.namedChildren.find((c) => c.type === 'identifier'));
    if (id) out.add(id.text);
  }
  return out;
}

/** Calls that are part of an `assert` statement's own expression. */
function insideAssert(node: Node, stop: Node): boolean {
  for (let p = node.parent; p && p.id !== stop.id; p = p.parent) if (p.type === 'assert_statement') return true;
  return false;
}

function mayAssertCalls(body: Node, info: PyFileInfo, cls: Node | null, params: Set<string>, visiting: Set<number>): string[] {
  const out = new Set<string>();
  const methods = methodsOf(cls);
  for (const call of body.descendantsOfType('call')) {
    if (assertionCall(call, info.resolver) || insideAssert(call, body)) continue;
    const fnNode = call.childForFieldName('function');
    const name = fnNode ? dotted(fnNode) : null;
    if (!name) continue;
    const label = name.join('.');
    const root = name[0]!;
    const last = name[name.length - 1]!;
    if (ASSERTION_LIKE.test(last)) {
      out.add(label);
      continue;
    }
    if (name.length === 1) {
      if (PY_BUILTINS.has(root)) continue;
      const def = info.functions.get(root);
      if (def) {
        if (mayAssert(def, info, null, visiting)) out.add(label);
        continue;
      }
      const module = info.imports.get(root);
      if (module !== undefined && !params.has(root)) {
        if (isSupportModule(module)) out.add(label);
        continue;
      }
      out.add(label); // a fixture called as a function, a local variable, an unresolved name
      continue;
    }
    if (root === 'self' && name.length === 2) {
      const def = methods.get(last);
      if (def) {
        if (mayAssert(def, info, cls, visiting)) out.add(label);
      } else if (!TESTCASE_API.has(last)) {
        out.add(label); // inherited from a base class we cannot see
      }
      continue;
    }
    const module = info.imports.get(root);
    if (module !== undefined && !params.has(root) && isSupportModule(module)) out.add(label);
  }
  return [...out].sort();
}

/** Calls in a test body that may assert on its behalf; `cls` is the enclosing test class, if any. */
export function pyHelperCalls(fn: Node, info: PyFileInfo, cls: Node | null): string[] {
  const body = fn.childForFieldName('body');
  return body ? mayAssertCalls(body, info, cls, parameterNames(fn), new Set()) : [];
}
