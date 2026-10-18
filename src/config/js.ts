// JS/TS runner configs (vitest.config.*, jest.config.*, playwright.config.*)
// read statically: the exported object literal, through `defineConfig(...)`,
// `defineProject(...)`, a `() => ({...})` factory, `satisfies`/`as`, or a
// top-level `const config = {...}`. Only literals are understood; everything
// else is `unknown`.
import type { Node } from 'web-tree-sitter';
import { getParser, languageForPath } from '../parse/loader.js';
import { jsKey, jsString, unwrap } from '../parse/normalise.js';
import { numberLiteral, type ConfigValue } from './values.js';
import { nameTable } from '../util/names.js';

/** Values of `...configDefaults.x` (vitest) and `...defaults.x` (jest-config) spreads. */
const VITEST_DEFAULTS = nameTable('KNOWN_DEFAULTS.vitest', { exclude: ['**/node_modules/**', '**/.git/**'], include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'] });
const KNOWN_DEFAULTS: Readonly<Record<string, Readonly<Record<string, string[]>>>> = nameTable('KNOWN_DEFAULTS', {
  vitest: VITEST_DEFAULTS,
  'vitest/config': VITEST_DEFAULTS,
  'jest-config': nameTable('KNOWN_DEFAULTS.jest-config', {
    testPathIgnorePatterns: ['/node_modules/'],
    testMatch: ['**/__tests__/**/*.?([mc])[jt]s?(x)', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)'],
  }),
});

const line = (n: Node): number => n.startPosition.row + 1;

interface Scope {
  consts: Map<string, Node>;
  imports: Map<string, string>;
}

function evaluate(node: Node, scope: Scope, depth = 0): ConfigValue {
  const n = unwrap(node);
  const at = line(n);
  const unknown: ConfigValue = { t: 'unknown', text: n.text.slice(0, 80), line: at };
  if (depth > 8) return unknown;
  switch (n.type) {
    case 'string':
    case 'template_string': {
      const v = jsString(n);
      return v === null ? unknown : { t: 'str', v, line: at };
    }
    case 'number': {
      const v = numberLiteral(n.text);
      return v === null ? unknown : { t: 'num', v, line: at };
    }
    case 'true':
    case 'false':
      return { t: 'bool', v: n.type === 'true', line: at };
    case 'null':
    case 'undefined':
      return { t: 'null', line: at };
    case 'regex': {
      const pattern = n.childForFieldName('pattern')?.text ?? '';
      return { t: 'regex', v: pattern, line: at };
    }
    case 'unary_expression': {
      const arg = n.childForFieldName('argument');
      const op = n.childForFieldName('operator')?.text;
      const v = arg ? evaluate(arg, scope, depth + 1) : unknown;
      if (v.t === 'num' && op === '-') return { t: 'num', v: -v.v, line: at };
      if (v.t === 'bool' && op === '!') return { t: 'bool', v: !v.v, line: at };
      return unknown;
    }
    case 'binary_expression': {
      const l = evaluate(n.childForFieldName('left')!, scope, depth + 1);
      const r = evaluate(n.childForFieldName('right')!, scope, depth + 1);
      const op = n.childForFieldName('operator')?.text;
      if (l.t === 'num' && r.t === 'num') {
        const v = op === '*' ? l.v * r.v : op === '+' ? l.v + r.v : op === '-' ? l.v - r.v : op === '/' ? l.v / r.v : NaN;
        return Number.isFinite(v) ? { t: 'num', v, line: at } : unknown;
      }
      return unknown;
    }
    case 'array': {
      const items: ConfigValue[] = [];
      for (const c of n.namedChildren) {
        if (c.type === 'comment') continue;
        if (c.type === 'spread_element') {
          const spread = spreadDefaults(c.namedChildren[0] ?? null, scope);
          if (spread) items.push(...spread.map((v): ConfigValue => ({ t: 'str', v, line: line(c) })));
          else items.push({ t: 'unknown', text: c.text, line: line(c) });
        } else items.push(evaluate(c, scope, depth + 1));
      }
      return { t: 'arr', items, line: at };
    }
    case 'object': {
      const props = new Map<string, ConfigValue>();
      let open = false;
      for (const c of n.namedChildren) {
        if (c.type === 'comment') continue;
        if (c.type === 'pair') {
          const key = c.childForFieldName('key')!;
          const name = jsKey(key);
          if (name === null) {
            open = true;
            continue;
          }
          const v = evaluate(c.childForFieldName('value')!, scope, depth + 1);
          props.set(name, { ...v, line: line(key) });
        } else if (c.type === 'shorthand_property_identifier') {
          const target = scope.consts.get(c.text);
          props.set(c.text, target ? { ...evaluate(target, scope, depth + 1), line: line(c) } : { t: 'unknown', text: c.text, line: line(c) });
        } else {
          open = true; // spread, method
        }
      }
      return { t: 'obj', props, line: at, open };
    }
    case 'identifier': {
      const target = scope.consts.get(n.text);
      return target ? evaluate(target, scope, depth + 1) : unknown;
    }
    case 'call_expression': {
      const fn = n.childForFieldName('function');
      const args = n.childForFieldName('arguments')?.namedChildren.filter((c) => c.type !== 'comment') ?? [];
      if (fn?.type === 'identifier' && ['defineConfig', 'defineProject'].includes(fn.text) && args.length === 1) {
        return evaluate(args[0]!, scope, depth + 1);
      }
      return unknown;
    }
    case 'arrow_function': {
      const body = n.childForFieldName('body');
      return body && body.type !== 'statement_block' ? evaluate(body, scope, depth + 1) : unknown;
    }
    default:
      return unknown;
  }
}

/** `...configDefaults.exclude` → vitest's default exclude, when `configDefaults` is imported from vitest. */
function spreadDefaults(expr: Node | null, scope: Scope): string[] | null {
  if (expr?.type !== 'member_expression') return null;
  const object = expr.childForFieldName('object');
  const property = expr.childForFieldName('property')?.text;
  if (object?.type !== 'identifier' || !property) return null;
  const module = scope.imports.get(object.text);
  return module ? (KNOWN_DEFAULTS[module]?.[property] ?? null) : null;
}

function collectScope(root: Node): Scope {
  const consts = new Map<string, Node>();
  const imports = new Map<string, string>();
  for (const stmt of root.namedChildren) {
    const decl = stmt.type === 'export_statement' ? stmt.childForFieldName('declaration') : stmt;
    if (decl?.type === 'lexical_declaration' || decl?.type === 'variable_declaration') {
      for (const d of decl.namedChildren) {
        const name = d.childForFieldName('name');
        const value = d.childForFieldName('value');
        if (name?.type === 'identifier' && value) consts.set(name.text, value);
        // const { configDefaults } = require('vitest/config')
        if (name?.type === 'object_pattern' && value?.type === 'call_expression' && value.childForFieldName('function')?.text === 'require') {
          const spec = value.childForFieldName('arguments')?.namedChildren[0];
          const module = jsString(spec);
          if (module !== null) for (const p of name.namedChildren) imports.set(p.text, module);
        }
      }
    }
    if (stmt.type === 'import_statement') {
      const spec = jsString(stmt.childForFieldName('source')) ?? undefined;
      if (!spec) continue;
      for (const s of stmt.descendantsOfType('import_specifier')) {
        const local = s.childForFieldName('alias') ?? s.childForFieldName('name');
        if (local) imports.set(local.text, spec);
      }
    }
  }
  return { consts, imports };
}

/** The exported configuration of a JS/TS config file, or `unknown` if it cannot be located. */
export async function readJsConfig(path: string, source: string): Promise<ConfigValue> {
  const lang = languageForPath(path) ?? 'typescript';
  const tree = (await getParser(lang)).parse(source);
  if (!tree) return { t: 'unknown', text: 'unparseable', line: 1 };
  try {
    const root = tree.rootNode;
    if (root.hasError) return { t: 'unknown', text: 'syntax errors', line: 1 };
    const scope = collectScope(root);
    for (const stmt of root.namedChildren) {
      if (stmt.type === 'export_statement' && /^export\s+default\b/.test(stmt.text)) {
        const value = stmt.childForFieldName('value') ?? stmt.namedChildren[stmt.namedChildren.length - 1];
        if (value) return evaluate(value, scope);
      }
      if (stmt.type === 'expression_statement') {
        const a = stmt.namedChildren[0];
        if (a?.type === 'assignment_expression' && a.childForFieldName('left')?.text === 'module.exports') {
          return evaluate(a.childForFieldName('right')!, scope);
        }
      }
    }
    return { t: 'unknown', text: 'no default export', line: 1 };
  } finally {
    tree.delete();
  }
}
