// A small value model shared by the config readers (JSON, JS/TS objects,
// TOML): literal values keep the line they were written on, and anything
// that is not a literal is `unknown` — never guessed.

export type ConfigValue =
  | { t: 'str'; v: string; line: number }
  | { t: 'num'; v: number; line: number }
  | { t: 'bool'; v: boolean; line: number }
  | { t: 'null'; line: number }
  | { t: 'regex'; v: string; line: number }
  | { t: 'arr'; items: ConfigValue[]; line: number }
  | { t: 'obj'; props: Map<string, ConfigValue>; line: number; open: boolean }
  | { t: 'unknown'; text: string; line: number };

export type ConfigObject = Extract<ConfigValue, { t: 'obj' }>;

/** Property `key` of an object value; `undefined` when absent, `unknown` when the object may hide it. */
export function prop(obj: ConfigValue | undefined | null, key: string): ConfigValue | undefined {
  if (!obj) return undefined;
  if (obj.t !== 'obj') return { t: 'unknown', text: '', line: obj.line };
  const v = obj.props.get(key);
  if (v) return v;
  return obj.open ? { t: 'unknown', text: '(spread)', line: obj.line } : undefined;
}

/** Whether a value is made only of literals (no `unknown`, no spread or computed keys). */
export function fullyLiteral(v: ConfigValue): boolean {
  if (v.t === 'unknown') return false;
  if (v.t === 'arr') return v.items.every(fullyLiteral);
  if (v.t === 'obj') return !v.open && [...v.props.values()].every(fullyLiteral);
  return true;
}

/** A list of strings, or null if any element is not a literal string. */
export function stringList(v: ConfigValue | undefined): string[] | null {
  if (!v) return null;
  if (v.t === 'str') return [v.v];
  if (v.t !== 'arr') return null;
  const out: string[] = [];
  for (const item of v.items) {
    if (item.t === 'str') out.push(item.v);
    else if (item.t === 'regex') out.push(item.v);
    else return null;
  }
  return out;
}

/** Canonical text of a value, to compare base and head (lines ignored). */
export function canonical(v: ConfigValue | undefined): string {
  if (!v) return 'absent';
  switch (v.t) {
    case 'str':
    case 'num':
    case 'bool':
    case 'regex':
      return `${v.t}:${JSON.stringify(v.v)}`;
    case 'null':
      return 'null';
    case 'arr':
      return `[${v.items.map(canonical).join(',')}]`;
    case 'obj':
      return `{${[...v.props].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',')}${v.open ? ',...' : ''}}`;
    case 'unknown':
      return `unknown:${v.text}`;
  }
}

/**
 * POSIX shell-style word splitting (quotes and backslashes, no expansion),
 * as Python's `shlex.split` does for pytest's `addopts`. Null on an
 * unterminated quote.
 */
export function shellWords(text: string): string[] | null {
  const out: string[] = [];
  let word = '';
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) return null;
      word += text.slice(i + 1, end);
      inWord = true;
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === '\\' && j + 1 < text.length && '"\\$`\n'.includes(text[j + 1]!)) j++;
        word += text[j];
      }
      if (j >= text.length) return null;
      inWord = true;
      i = j;
    } else if (c === '\\' && i + 1 < text.length) {
      word += text[++i];
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) out.push(word);
      word = '';
      inWord = false;
    } else {
      word += c;
      inWord = true;
    }
  }
  if (inWord) out.push(word);
  return out;
}

/** Parses a JS-style number literal (`60_000`, `1e3`, `0x10`); null if it is not one. */
export function numberLiteral(text: string): number | null {
  const t = text.replace(/_/g, '').trim();
  if (!/^[+-]?(?:0[xob][0-9a-f]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)$/i.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
