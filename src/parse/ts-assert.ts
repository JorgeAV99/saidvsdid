// Assertions and assertion-capable calls in JS/TS test bodies (TG004).
//
// An assertion is `expect(...)` followed by a matcher (`.toBe(1)`,
// `.not.toBeNull()`, chai's `.to.be.true`), `expect.assertions(n)`,
// `assert(...)` / `assert.x(...)` / `sinon.assert.x(...)`. A bare
// `expect(x)` without a matcher asserts nothing and is not counted.
//
// A test with no assertion of its own may still assert through a helper. The
// calls that *may* do so are listed (never guessed away): same-file helpers
// that assert or call something unknown, anything imported from a
// test-support module, assertion-like names, `this.x()`, and identifiers that
// resolve to nothing in the file (globals registered by a setup file).
//
// Each assertion carries its root's Binding (src/parse/ts-binding.ts): certain
// only when `expect`, `assert`, `sinon`… is a static import of a runner or an
// assertion library that nothing closer declares again. A global `expect`
// (jest's) or a local one is uncertain: TG004 never FAILs on it.
import type { Node } from 'web-tree-sitter';
import { normaliseBody } from './conditions.js';
import { unwrap } from './normalise.js';
import { TsResolver } from './ts-binding.js';
import { uncertain, type Assertion, type Binding } from './types.js';

const line = (n: Node): number => n.startPosition.row + 1;

function callArgs(call: Node): Node[] {
  const a = call.childForFieldName('arguments');
  if (!a || a.type === 'template_string') return a ? [a] : [];
  return a.namedChildren.filter((c) => c.type !== 'comment');
}

/** `a.b.c`, `(a as T).b.c` → ['a', 'b', 'c']; null when the chain contains anything but names. */
function memberNames(written: Node): string[] | null {
  const node = unwrap(written);
  if (node.type === 'identifier' || node.type === 'this') return [node.text];
  if (node.type === 'member_expression') {
    const object = node.childForFieldName('object');
    const property = node.childForFieldName('property');
    const base = object ? memberNames(object) : null;
    return base && property ? [...base, property.text] : null;
  }
  return null;
}

/** The identifier at the root of a callee (`expect` in `expect.soft`, `sinon` in `sinon.assert.calledOnce`), or null. */
function rootIdentifier(node: Node): Node | null {
  let n: Node | null = unwrap(node);
  while (n && n.type === 'member_expression') {
    const object: Node | null = n.childForFieldName('object');
    n = object ? unwrap(object) : null;
  }
  return n?.type === 'identifier' ? n : null;
}

/** The binding of an assertion's root (see the header). */
function rootBinding(fn: Node, info: TsFileInfo): Binding {
  const root = rootIdentifier(fn);
  return root ? info.resolver.assertionRoot(root) : uncertain(`\`${normaliseBody(fn.text)}\` is not rooted in an import`);
}

/** `expect(x)`, `expect.soft(x)`, `expect.poll(fn)`, `expectTypeOf(x)`. */
function isExpectRoot(call: Node): boolean {
  const written = call.childForFieldName('function');
  const fn = written ? unwrap(written) : null;
  if (!fn) return false;
  if (fn.type === 'identifier') return fn.text === 'expect' || fn.text === 'expectTypeOf';
  const names = memberNames(fn);
  return names?.length === 2 && names[0] === 'expect' && (names[1] === 'soft' || names[1] === 'poll');
}

const CHAI_WORDS = new Set(['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'but', 'does', 'still', 'should', 'not', 'deep']);
const THROW_MATCHERS = new Set(['toThrow', 'toThrowError', 'toThrowErrorMatchingSnapshot', 'toThrowErrorMatchingInlineSnapshot']);

function normalise(text: string): string {
  return normaliseBody(text);
}

/** The assertion rooted at an `expect(...)` call, if a matcher follows it. */
function expectAssertion(root: Node, info: TsFileInfo): Assertion | null {
  const binding = rootBinding(root.childForFieldName('function')!, info);
  const props: string[] = [];
  let node = root;
  while (node.parent?.type === 'member_expression' && node.parent.childForFieldName('object')?.id === node.id) {
    node = node.parent;
    props.push(node.childForFieldName('property')?.text ?? '');
  }
  const subjectNode = callArgs(root)[0];
  const subject = subjectNode ? normalise(subjectNode.text) : null;
  const parent = node.parent;
  if (props.length > 0 && parent?.type === 'call_expression' && parent.childForFieldName('function')?.id === node.id) {
    const cleaned = props.filter((p) => p !== 'resolves' && p !== 'rejects');
    let matcher = cleaned.join('.');
    const last = cleaned[cleaned.length - 1] ?? '';
    if (THROW_MATCHERS.has(last) && callArgs(parent).length === 0) matcher += '()';
    return { line: line(root), text: normalise(parent.text), subject, matcher, binding };
  }
  // chai property assertions: expect(x).to.be.true, expect(x).to.not.exist
  if (props.length >= 2 && CHAI_WORDS.has(props[0]!)) {
    return { line: line(root), text: normalise(node.text), subject, matcher: props.join('.'), binding };
  }
  return null;
}

/** Every recognised assertion under `body`, in source order. */
export function tsAssertions(body: Node, info: TsFileInfo): Assertion[] {
  const out: Assertion[] = [];
  for (const call of body.descendantsOfType('call_expression')) {
    const a = assertionAt(call, info);
    if (a) out.push(a);
  }
  return out.sort((x, y) => x.line - y.line);
}

function assertionAt(call: Node, info: TsFileInfo): Assertion | null {
  if (isExpectRoot(call)) return expectAssertion(call, info);
  const written = call.childForFieldName('function');
  const fn = written ? unwrap(written) : null;
  if (!fn) return null;
  const first = callArgs(call)[0];
  const subject = first ? normalise(first.text) : null;
  if (fn.type === 'identifier' && (fn.text === 'assert' || fn.text === 'assertType')) {
    return { line: line(call), text: normalise(call.text), subject, matcher: fn.text, binding: rootBinding(fn, info) };
  }
  const names = memberNames(fn);
  if (!names || names.length < 2) return null;
  if (names[0] === 'expect' && (names[1] === 'assertions' || names[1] === 'hasAssertions') && names.length === 2) {
    return { line: line(call), text: normalise(call.text), subject: null, matcher: `expect.${names[1]}`, binding: rootBinding(fn, info) };
  }
  const at = names.slice(0, -1).lastIndexOf('assert');
  if (at === -1) return null;
  return { line: line(call), text: normalise(call.text), subject, matcher: `assert.${names.slice(at + 1).join('.')}`, binding: rootBinding(fn, info) };
}

// ---------------------------------------------------------------------------
// Calls that may assert on the test's behalf

/** Names that suggest an encapsulated assertion. */
export const ASSERTION_LIKE = /^(?:expect|assert|verify|check|ensure|should|must|validate)|(?:Expect|Assert|Verify|Check|Should)(?:[A-Z_]|$)/;

/** Module specifiers that look like test support code rather than the code under test. */
export const TEST_SUPPORT_MODULE =
  /(?:^|[/._@-])(?:tests?|specs?|__tests__|__mocks__|e2e|helpers?|fixtures?|support|testing|test-?utils|setup|asserts?|assertions?|matchers?|mocks?|conftest)(?:[/._-]|$)/i;

/** Assertion libraries: anything called from them may assert. */
const ASSERTION_PACKAGES = new Set(['assert', 'node:assert', 'node:assert/strict', 'assert/strict', 'chai', 'expect', 'should', 'power-assert', 'sinon', 'uvu/assert']);
/** Test runners: their exports are the test API (handled as declarations/assertions), not helpers. */
const RUNNER_PACKAGES = new Set(['vitest', '@jest/globals', '@playwright/test', 'mocha', 'node:test', 'bun:test', '@vitest/runner']);

const TEST_API = new Set([
  'describe', 'it', 'test', 'suite', 'context', 'specify', 'fit', 'fdescribe', 'xit', 'xtest', 'xdescribe',
  'beforeEach', 'beforeAll', 'afterEach', 'afterAll', 'before', 'after', 'expect', 'assert', 'expectTypeOf', 'assertType',
  'vi', 'jest',
]);

const JS_GLOBALS = new Set([
  'console', 'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Promise', 'Symbol', 'BigInt',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'parseInt',
  'parseFloat', 'isNaN', 'isFinite', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'queueMicrotask', 'structuredClone', 'fetch', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'Buffer', 'process', 'require', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'Intl', 'Reflect', 'Proxy',
  'globalThis', 'atob', 'btoa', 'AbortController', 'ArrayBuffer', 'Uint8Array', 'Int32Array', 'Float64Array',
  'DataView', 'Blob', 'Headers', 'Request', 'Response', 'FormData', 'Event', 'EventTarget',
]);

const FUNCTION_TYPES = new Set(['arrow_function', 'function_expression', 'function', 'function_declaration', 'generator_function_declaration']);

export interface TsFileInfo {
  /** Same-file function definitions by name (declarations and `const f = () => ...`). */
  locals: Map<string, Node[]>;
  /** Local binding → module specifier, from `import` and `require`. */
  imports: Map<string, string>;
  memo: Map<number, boolean>;
  /** Where the test API's names come from (src/parse/ts-binding.ts). */
  resolver: TsResolver;
}

function stringText(node: Node | null): string | null {
  if (!node || (node.type !== 'string' && node.type !== 'template_string')) return null;
  return node.text.slice(1, -1);
}

function patternNames(pattern: Node, out: string[]): void {
  if (pattern.type === 'identifier' || pattern.type === 'shorthand_property_identifier_pattern') {
    out.push(pattern.text);
    return;
  }
  if (pattern.type === 'pair_pattern') {
    const value = pattern.childForFieldName('value');
    if (value) patternNames(value, out);
    return;
  }
  for (const c of pattern.namedChildren) patternNames(c, out);
}

/** `require('m')`, possibly awaited or wrapped: the module specifier, or null. */
function requireSpecifier(value: Node | null): string | null {
  if (value?.type !== 'call_expression') return null;
  const fn = value.childForFieldName('function');
  if (fn?.type !== 'identifier' || fn.text !== 'require') return null;
  return stringText(callArgs(value)[0] ?? null);
}

export function tsFileInfo(root: Node, source: string, path: string): TsFileInfo {
  const locals = new Map<string, Node[]>();
  const imports = new Map<string, string>();
  const addLocal = (name: string, fn: Node): void => {
    locals.set(name, [...(locals.get(name) ?? []), fn]);
  };

  for (const imp of root.descendantsOfType('import_statement')) {
    const spec = stringText(imp.childForFieldName('source'));
    if (spec === null) continue;
    for (const clause of imp.namedChildren.filter((c) => c.type === 'import_clause')) {
      for (const part of clause.namedChildren) {
        if (part.type === 'identifier') imports.set(part.text, spec);
        else if (part.type === 'namespace_import') {
          const id = part.namedChildren.find((c) => c.type === 'identifier');
          if (id) imports.set(id.text, spec);
        } else if (part.type === 'named_imports') {
          for (const s of part.namedChildren.filter((c) => c.type === 'import_specifier')) {
            const local = s.childForFieldName('alias') ?? s.childForFieldName('name');
            if (local) imports.set(local.text, spec);
          }
        }
      }
    }
  }
  for (const decl of root.descendantsOfType('variable_declarator')) {
    const name = decl.childForFieldName('name');
    const value = decl.childForFieldName('value');
    if (!name) continue;
    const spec = requireSpecifier(value);
    if (spec !== null) {
      const names: string[] = [];
      patternNames(name, names);
      for (const n of names) imports.set(n, spec);
    } else if (name.type === 'identifier' && value && FUNCTION_TYPES.has(value.type)) {
      addLocal(name.text, value);
    }
  }
  for (const fn of root.descendantsOfType(['function_declaration', 'generator_function_declaration'])) {
    const name = fn.childForFieldName('name');
    if (name) addLocal(name.text, fn);
  }
  return { locals, imports, memo: new Map(), resolver: new TsResolver(root, source, path) };
}

function isSupportModule(spec: string): boolean {
  if (RUNNER_PACKAGES.has(spec)) return false;
  return ASSERTION_PACKAGES.has(spec) || TEST_SUPPORT_MODULE.test(spec);
}

/** Whether a same-file function may assert: it asserts, or calls something that may. */
function localMayAssert(fn: Node, info: TsFileInfo, visiting: Set<number>): boolean {
  const known = info.memo.get(fn.id);
  if (known !== undefined) return known;
  if (visiting.has(fn.id)) return false;
  visiting.add(fn.id);
  const body = fn.childForFieldName('body') ?? fn;
  const result = tsAssertions(body, info).length > 0 || mayAssertCalls(body, info, visiting).length > 0;
  visiting.delete(fn.id);
  info.memo.set(fn.id, result);
  return result;
}

/** Labels of the calls under `body` that may contain assertions. */
function mayAssertCalls(body: Node, info: TsFileInfo, visiting: Set<number>): string[] {
  const out = new Set<string>();
  for (const call of body.descendantsOfType('call_expression')) {
    if (assertionAt(call, info) || isExpectRoot(call)) continue;
    const fn = call.childForFieldName('function');
    if (!fn) continue;
    const passesAssert = callArgs(call).some((a) => a.type === 'identifier' && (a.text === 'expect' || a.text === 'assert'));
    const names = memberNames(fn);
    if (!names) {
      if (passesAssert) out.add(normaliseBody(fn.text));
      continue;
    }
    const label = names.join('.');
    const rootName = names[0]!;
    const last = names[names.length - 1]!;
    if (passesAssert || ASSERTION_LIKE.test(last)) {
      out.add(label);
      continue;
    }
    if (names.length === 1) {
      // A name of the test API is the runner's (it asserts nothing for the test) only through a static
      // import (src/parse/ts-binding.ts); a local `it` that asserts is a helper like any other.
      if ((TEST_API.has(rootName) && fn.type === 'identifier' && info.resolver.root(fn).kind !== 'uncertain') || JS_GLOBALS.has(rootName)) continue;
      if (TEST_API.has(rootName) && !info.locals.has(rootName) && info.imports.get(rootName) === undefined) continue; // a global of the runner
      const defs = info.locals.get(rootName);
      if (defs) {
        if (defs.some((d) => localMayAssert(d, info, visiting))) out.add(label);
        continue;
      }
      const spec = info.imports.get(rootName);
      if (spec !== undefined) {
        if (isSupportModule(spec)) out.add(label);
        continue;
      }
      // A variable or parameter holding a function, or a global registered by
      // a setup file: we cannot see what it does.
      out.add(label);
      continue;
    }
    if (rootName === 'this') {
      out.add(label);
      continue;
    }
    const spec = info.imports.get(rootName);
    if (spec !== undefined && isSupportModule(spec)) out.add(label);
  }
  return [...out].sort();
}

export function tsHelperCalls(body: Node, info: TsFileInfo): string[] {
  return mayAssertCalls(body, info, new Set());
}
