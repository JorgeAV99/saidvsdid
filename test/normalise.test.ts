// One normalisation for every reader of expressions, keys, literals and strings (src/parse/normalise.ts):
// parentheses and TypeScript's type assertions read away, in both trees (tree-sitter and the compiler),
// in an expression, a subscript and a computed key; literals decoded as the language does.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import type { Node } from 'web-tree-sitter';
import { describe, expect, it } from 'vitest';
import { getParser } from '../src/parse/loader.js';
import { WRAPPERS, decodeJs, jsKey, jsMember, jsString, memberChain, pyString, tsKey, unwrap, unwrapTs } from '../src/parse/normalise.js';

const BS = String.fromCharCode(92);

async function tsx<T>(source: string, read: (root: Node) => T, language: 'tsx' | 'typescript' = 'tsx'): Promise<T> {
  const tree = (await getParser(language)).parse(source)!;
  try {
    return read(tree.rootNode);
  } finally {
    tree.delete();
  }
}
async function python<T>(source: string, read: (root: Node) => T): Promise<T> {
  const tree = (await getParser('python')).parse(source)!;
  try {
    return read(tree.rootNode);
  } finally {
    tree.delete();
  }
}
const firstValue = (root: Node): Node => root.descendantsOfType('variable_declarator')[0]!.childForFieldName('value')!;

describe('the wrappers, one list for both trees', () => {
  const forms: Array<[string, string]> = [
    ['(x)', '((it))'],
    ['x as T', 'it as any'],
    ['x as const', "'skip' as const"],
    ['x satisfies T', 'it satisfies object'],
    ['x!', 'it!'],
    ['<T>x', '<any>it'],
    ['x<T>', 'it<string>'],
  ];
  it('the list names every wrapper this test probes', () => {
    expect(WRAPPERS.map((w) => w.form).sort()).toEqual(['(x)', '<T>x', 'x as T, x as const', 'x satisfies T', 'x!', 'x<T>'].sort());
  });
  it.each(forms)('tree-sitter: `%s`', async (form, expr) => {
    // `<any>it` is a type assertion in a .ts file (in .tsx it would be JSX).
    const inner = await tsx(`const v = ${expr};`, (r) => {
      const n = unwrap(firstValue(r));
      return [n.type, n.text];
    }, form === '<T>x' ? 'typescript' : 'tsx');
    expect(['identifier', 'string']).toContain(inner[0]);
  });
  it.each(forms)('the compiler: `%s`', (_form, expr) => {
    // `<any>it` is a type assertion in a .ts file (in .tsx it would be JSX).
    const sf = ts.createSourceFile('/a.ts', `const v = ${expr};`, ts.ScriptTarget.ESNext, true);
    const decl = (sf.statements[0] as ts.VariableStatement).declarationList.declarations[0]!;
    const inner = unwrapTs(decl.initializer!);
    expect(ts.isIdentifier(inner) || ts.isStringLiteral(inner)).toBe(true);
  });
  it('Python: parentheses', async () => {
    expect(await python('x = ((pytest.skip))\n', (r) => unwrap(r.descendantsOfType('assignment')[0]!.childForFieldName('right')!).text)).toBe('pytest.skip');
  });
});

describe('keys, members and literals: read through the wrappers, escapes decoded', () => {
  it.each([
    ["{ skip: omit }", 'skip'],
    ["{ 'skip': omit }", 'skip'],
    ["{ ['skip']: omit }", 'skip'],
    ["{ [('skip')]: omit }", 'skip'],
    ["{ ['skip' as const]: omit }", 'skip'],
    [`{ ['${BS}u0073kip']: omit }`, 'skip'],
    ["{ [name]: omit }", null],
    ["{ ['sk' + 'ip']: omit }", null],
  ] as const)('a pattern key `%s` (tree-sitter and the compiler)', async (pattern, expected) => {
    expect(await tsx(`const ${pattern} = it;`, (r) => jsKey(r.descendantsOfType('pair_pattern')[0]!.childForFieldName('key')))).toBe(expected);
    const sf = ts.createSourceFile('/a.ts', `const ${pattern} = it;`, ts.ScriptTarget.ESNext, true);
    const binding = ((sf.statements[0] as ts.VariableStatement).declarationList.declarations[0]!.name as ts.ObjectBindingPattern).elements[0]!;
    expect(tsKey(binding.propertyName)).toBe(expected);
  });

  it.each([
    ["it['skip']", 'skip'],
    ["it[('skip')]", 'skip'],
    ["it['skip' as const]", 'skip'],
    ['it[`skip`]', 'skip'],
    ['it[k]', null],
  ] as const)('a member `%s`', async (expr, expected) => {
    expect(await tsx(`const v = ${expr};`, (r) => jsMember(firstValue(r))?.name ?? null)).toBe(expected);
  });

  it('JavaScript strings: escapes decoded, a legacy octal escape is not certain, a substitution is not a literal', async () => {
    expect(decodeJs(`${BS}u0073${BS}u{6b}${BS}x69p`)).toBe('skip');
    expect(decodeJs(`a${BS}0b`)).toBe('a\0b');
    expect(decodeJs(`${BS}163kip`)).toBeNull();
    expect(decodeJs(`${BS}8`)).toBeNull();
    expect(await tsx('const v = `sk${x}`;', (r) => jsString(firstValue(r)))).toBeNull();
    expect(await tsx("const v = ('skip' as const);", (r) => jsString(firstValue(r)))).toBe('skip');
  });

  it.each([
    ['"skip"', 'skip'],
    ["r'sk\\ip'", 'sk\\ip'],
    ['"\\x73kip"', 'skip'],
    ['"\\163kip"', 'skip'],
    ['"sk" "ip"', 'skip'],
    ['("skip")', 'skip'],
    ['f"skip"', 'skip'],
    ['f"sk{x}"', null],
    ['b"skip"', null],
    ['"\\N{LATIN SMALL LETTER S}kip"', null],
    ['"\\q"', '\\q'],
  ] as const)('a Python string `%s`', async (literal, expected) => {
    expect(await python(`x = ${literal}\n`, (r) => pyString(r.descendantsOfType('assignment')[0]!.childForFieldName('right')))).toBe(expected);
  });
});

describe('one member access, however written (memberStep, memberChain)', () => {
  const chain = (c: ReturnType<typeof memberChain>): string[] | null => c?.map((n) => n.name) ?? null;
  it.each([
    'this.a.k', "this['a'].k", "this.a['k']", "Reflect.get(this.a, 'k')", "Reflect['get'](this['a'], 'k')", "Reflect.get(Reflect.get(this, 'a'), 'k', this)", "(Reflect.get(this, ('a' as const))).k",
  ])('JS/TS %s is this → a → k', async (expr) => {
    expect(await tsx(`const x = ${expr};`, (root) => chain(memberChain(firstValue(root), 'js')))).toEqual(['this', 'a', 'k']);
  });
  it.each(['self.a.k', 'self["a"].k', 'getattr(self.a, "k")', 'getattr(getattr(self, "a"), "k", None)', '(getattr(self, "a"))["k"]'])('Python %s is self → a → k', async (expr) => {
    expect(await python(`x = ${expr}\n`, (root) => chain(memberChain(root.descendantsOfType('assignment')[0]!.childForFieldName('right')!, 'python')))).toEqual(['self', 'a', 'k']);
  });
  it.each([
    // A primitive that returns no member, a name computed at run time, a call, a spread or a keyword: no chain.
    "Reflect.has(this.a, 'k')", 'Reflect.get(this.a, k)', "f().k", "Reflect.get(...args, 'k')", "Reflect.get(this.a, 'k', r, extra)",
  ])('JS/TS %s is no chain', async (expr) => {
    expect(await tsx(`const x = ${expr};`, (root) => chain(memberChain(firstValue(root), 'js')))).toBeNull();
  });
  it.each(['hasattr(self.a, "k")', 'getattr(self.a, k)', 'getattr(self.a, name="k")', 'setattr(self.a, "k", v)', 'f().k'])('Python %s is no chain', async (expr) => {
    expect(await python(`x = ${expr}\n`, (root) => chain(memberChain(root.descendantsOfType('assignment')[0]!.childForFieldName('right')!, 'python')))).toBeNull();
  });
});

describe('one normalisation: no reader keeps its own', () => {
  it('no reader of code (src/parse, src/rules, src/config) but src/parse/normalise.ts defines an unwrap, a string or key reader, or an escape decoder', () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    for (const dir of ['src/parse', 'src/rules', 'src/config']) walk(dir);
    const own = /\bfunction\s+(unwrap|unparen|outerParen|stringLiteral|memberAccess|literalKey|skipWrappers|decodeEscapes?|decodeString|unwrapWrappers)\s*\(/;
    const offenders = files.filter((f) => !f.endsWith(join('parse', 'normalise.ts')) && own.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
