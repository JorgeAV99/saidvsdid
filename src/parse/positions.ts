// Positions between the parsers that read one source: tree-sitter (extraction), Python's `ast`
// (python/saidvsdid_scopes.py) and the TypeScript compiler (ts-binding.ts).
//
// - tree-sitter and the TypeScript compiler both index a JavaScript string by UTF-16 code units, so
//   a tree-sitter `startIndex` is a TypeScript position as it is (test/positions.test.ts holds them
//   to it with astral characters, a BOM and CRLF).
// - Python's `ast` gives a line (1-based; `\r\n`, `\r` and `\n` each end one, unlike tree-sitter's
//   rows) and a column in UTF-8 bytes of that line. The source Python reads has no BOM (py-scopes.ts
//   strips it), so its positions start one code unit later in a source that has one.

/** The UTF-16 index where each of Python's lines starts (index 0 is line 1). */
export function pythonLineStarts(source: string): number[] {
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  const starts = [bom];
  for (let i = bom; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (c === 0x0d) {
      if (source.charCodeAt(i + 1) === 0x0a) i++;
      starts.push(i + 1);
    } else if (c === 0x0a) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/** The UTF-8 length of the code point at `i` and how many UTF-16 units it takes. */
function codePoint(source: string, i: number): { bytes: number; units: number } {
  const cp = source.codePointAt(i)!;
  const units = cp > 0xffff ? 2 : 1;
  return { bytes: cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4, units };
}

/** The UTF-16 index of Python's (line, UTF-8 column) in `source`, or null when it is not on a code point boundary of that line. */
export function pythonIndex(source: string, starts: readonly number[], line: number, column: number): number | null {
  const start = starts[line - 1];
  if (start === undefined || column < 0) return null;
  const end = starts[line] ?? source.length;
  let i = start;
  let bytes = 0;
  while (bytes < column && i < end) {
    const { bytes: b, units } = codePoint(source, i);
    bytes += b;
    i += units;
  }
  return bytes === column ? i : null;
}
