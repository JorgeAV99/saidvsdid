// Positions between the parsers that read one source (src/parse/positions.ts): Python's `ast` gives
// UTF-8 columns on its own lines, tree-sitter and the TypeScript compiler index UTF-16 code units.
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { getParser } from '../src/parse/loader.js';
import { pythonIndex, pythonLineStarts } from '../src/parse/positions.js';
import { pythonRuntime } from '../src/parse/py-scopes.js';

// Sources with what moves positions: astral characters (two UTF-16 units, four UTF-8 bytes),
// accented ones (one unit, two bytes), CJK (one unit, three bytes), CRLF, a lone CR, a BOM.
const PY_SOURCES = [
  'x = "é😀"; y = 1\n',
  'a = "停"\r\nb = a\r\n',
  'a = 1\rb = 2\n',
  '\uFEFFimport pytest\npytest.skip()\n',
  's = "𝒳𝒴"  # 😀\nt = s\n',
  'def f():\n    return "ñ" + "😀"\n\n\nz = f()\n',
];

describe('Python positions (UTF-8 columns on Python lines) → UTF-16 indexes', () => {
  it('splits lines where Python does: \\r\\n, \\r and \\n', () => {
    expect(pythonLineStarts('a\r\nb\rc\nd')).toEqual([0, 3, 5, 7]);
    expect(pythonLineStarts('\uFEFFa\nb')).toEqual([1, 3]);
  });

  it('converts multibyte columns and refuses a column inside a code point', () => {
    const src = 'x = "é😀"; y = 1\n';
    const starts = pythonLineStarts(src);
    // `y` is at UTF-8 byte 14 (`x = "` = 5; é = 2; 😀 = 4; `"; ` = 3), UTF-16 unit 11 (😀 takes two).
    expect(pythonIndex(src, starts, 1, 14)).toBe(11);
    expect(src.indexOf('y')).toBe(11);
    expect(pythonIndex(src, starts, 1, 6)).toBeNull(); // inside é
    expect(pythonIndex(src, starts, 9, 0)).toBeNull();
  });

  it('agrees with the interpreter on every name of each source', () => {
    const rt = pythonRuntime();
    if (!rt.known) throw new Error(`a supported Python is needed for this test: ${rt.why}`);
    const script = [
      'import ast, json, sys',
      'out = []',
      // Bytes decoded as UTF-8 whatever the platform's locale (Windows reads stdin as cp1252 otherwise).
      'for src in json.loads(sys.stdin.buffer.read().decode("utf-8")):',
      '    src = src[1:] if src.startswith("\\ufeff") else src',
      '    out.append([[n.id, n.lineno, n.col_offset] for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Name)])',
      'print(json.dumps(out))',
    ].join('\n');
    const names = JSON.parse(execFileSync(rt.command, ['-X', 'utf8', '-c', script], { input: JSON.stringify(PY_SOURCES), encoding: 'utf8' })) as Array<Array<[string, number, number]>>;
    let checked = 0;
    PY_SOURCES.forEach((src, i) => {
      const starts = pythonLineStarts(src);
      for (const [id, lineno, col] of names[i]!) {
        const at = pythonIndex(src, starts, lineno, col);
        expect(at, `${JSON.stringify(src)}: ${id} at ${lineno}:${col}`).not.toBeNull();
        expect(src.slice(at!, at! + id.length)).toBe(id);
        checked++;
      }
    });
    expect(checked).toBeGreaterThanOrEqual(12);
  });
});

describe('TypeScript positions: tree-sitter and the compiler both index UTF-16 code units', () => {
  const JS_SOURCES = [
    "const a = 'é😀'; it('x', () => {});\n",
    '\uFEFFimport { it } from "vitest";\r\nit("x", () => {});\r\n',
    "/* 𝒳𝒴 停 */ const 停 = it.skip; 停('x', () => {});\n",
    'const s = `😀${it}`;\rtest.only("y", () => {});\n',
  ];

  it('places every identifier at the same index in both parsers', async () => {
    const parser = await getParser('tsx');
    let checked = 0;
    for (const src of JS_SOURCES) {
      const tree = parser.parse(src)!;
      const fromTree = tree.rootNode.descendantsOfType('identifier').map((n) => [n.text, n.startIndex, n.endIndex]);
      tree.delete();
      const sf = ts.createSourceFile('/a.tsx', src, ts.ScriptTarget.ESNext, true);
      const fromTs: Array<[string, number, number]> = [];
      const visit = (n: ts.Node): void => {
        if (ts.isIdentifier(n)) fromTs.push([n.text, n.getStart(sf), n.end]);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      for (const t of fromTree) {
        expect(fromTs, JSON.stringify(src)).toContainEqual(t);
        checked++;
      }
    }
    expect(checked).toBe(10);
  });
});
