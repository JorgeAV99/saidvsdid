// Just enough TOML for one table (`[tool.pytest.ini_options]`): bare keys
// with strings (basic, literal, multi-line), numbers, booleans and arrays of
// those. Anything else in the table makes that key `unknown`.
import { numberLiteral, type ConfigValue } from './values.js';
import { nameTable } from '../util/names.js';

/** TOML's simple escapes in a basic string. */
const TOML_ESCAPES: Readonly<Record<string, string>> = nameTable('TOML_ESCAPES', { n: '\n', t: '\t', '"': '"', '\\': '\\', r: '\r' });

export interface TomlTable {
  entries: Map<string, ConfigValue>;
  /** 1-based line of the table header. */
  line: number;
}

class Cursor {
  i = 0;
  constructor(readonly s: string) {}
  get line(): number {
    return this.s.slice(0, this.i).split('\n').length;
  }
  skipSpace(newlines: boolean): void {
    for (;;) {
      const c = this.s[this.i];
      if (c === ' ' || c === '\t' || (newlines && (c === '\n' || c === '\r'))) this.i++;
      else if (newlines && c === '#') while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++;
      else return;
    }
  }
}

function basicString(c: Cursor, multi: boolean): string | null {
  const quote = multi ? '"""' : '"';
  c.i += quote.length;
  if (multi && c.s[c.i] === '\n') c.i++;
  let out = '';
  while (c.i < c.s.length) {
    if (c.s.startsWith(quote, c.i)) {
      c.i += quote.length;
      return out;
    }
    const ch = c.s[c.i]!;
    if (!multi && ch === '\n') return null;
    if (ch === '\\') {
      const e = c.s[c.i + 1];
      if (e && TOML_ESCAPES[e] !== undefined) {
        out += TOML_ESCAPES[e];
        c.i += 2;
        continue;
      }
      if (multi && e === '\n') {
        c.i += 2;
        c.skipSpace(true);
        continue;
      }
      return null;
    }
    out += ch;
    c.i++;
  }
  return null;
}

function literalString(c: Cursor, multi: boolean): string | null {
  const quote = multi ? "'''" : "'";
  c.i += quote.length;
  if (multi && c.s[c.i] === '\n') c.i++;
  const end = c.s.indexOf(quote, c.i);
  if (end === -1) return null;
  const v = c.s.slice(c.i, end);
  if (!multi && v.includes('\n')) return null;
  c.i = end + quote.length;
  return v;
}

function value(c: Cursor): ConfigValue | null {
  const line = c.line;
  const s = c.s;
  if (s.startsWith('"""', c.i)) {
    const v = basicString(c, true);
    return v === null ? null : { t: 'str', v, line };
  }
  if (s.startsWith("'''", c.i)) {
    const v = literalString(c, true);
    return v === null ? null : { t: 'str', v, line };
  }
  if (s[c.i] === '"') {
    const v = basicString(c, false);
    return v === null ? null : { t: 'str', v, line };
  }
  if (s[c.i] === "'") {
    const v = literalString(c, false);
    return v === null ? null : { t: 'str', v, line };
  }
  if (s[c.i] === '[') {
    c.i++;
    const items: ConfigValue[] = [];
    for (;;) {
      c.skipSpace(true);
      if (s[c.i] === ']') {
        c.i++;
        return { t: 'arr', items, line };
      }
      const item = value(c);
      if (!item) return null;
      items.push(item);
      c.skipSpace(true);
      if (s[c.i] === ',') c.i++;
      else if (s[c.i] !== ']') return null;
    }
  }
  const m = /^[^\s,\]#]+/.exec(s.slice(c.i));
  if (!m) return null;
  c.i += m[0].length;
  if (m[0] === 'true' || m[0] === 'false') return { t: 'bool', v: m[0] === 'true', line };
  const n = numberLiteral(m[0]);
  return n === null ? null : { t: 'num', v: n, line };
}

/** The table `[name]`, or null if the document has no such table. */
export function tomlTable(text: string, name: string): TomlTable | null {
  const src = text.replace(/\r\n?/g, '\n');
  const header = new RegExp(`^\\[\\s*${name.replace(/\./g, '\\s*\\.\\s*')}\\s*\\][ \\t]*(?:#.*)?$`, 'm');
  const h = header.exec(src);
  if (!h) return null;
  const c = new Cursor(src);
  c.i = h.index + h[0].length;
  const entries = new Map<string, ConfigValue>();
  const table = { entries, line: src.slice(0, h.index).split('\n').length };
  for (;;) {
    c.skipSpace(true);
    if (c.i >= src.length || src[c.i] === '[') return table;
    const lineStart = c.i;
    const key = /^([A-Za-z0-9_-]+|"[^"\n]*")[ \t]*=[ \t]*/.exec(src.slice(c.i));
    const lineEnd = src.indexOf('\n', c.i) === -1 ? src.length : src.indexOf('\n', c.i);
    if (!key) {
      c.i = lineEnd;
      continue;
    }
    const k = key[1]!.replace(/^"|"$/g, '');
    const line = c.line;
    c.i += key[0].length;
    const v = value(c);
    if (v) {
      entries.set(k, { ...v, line });
    } else {
      entries.set(k, { t: 'unknown', text: src.slice(lineStart, lineEnd), line });
      c.i = lineEnd;
    }
    const rest = src.indexOf('\n', c.i);
    c.i = rest === -1 ? src.length : rest;
  }
}
