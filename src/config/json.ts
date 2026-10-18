// JSON (package.json, jest.config.json) into the config value model, keeping
// the line of every value.
import type { ConfigValue } from './values.js';

/** @param onDuplicate called with every key that appears twice in the same object. */
export function parseJsonValue(text: string, onDuplicate?: (key: string) => void): ConfigValue | null {
  let i = 0;
  let line = 1;
  const s = text;
  const ws = (): void => {
    while (i < s.length && /\s/.test(s[i]!)) {
      if (s[i] === '\n') line++;
      i++;
    }
  };
  const str = (): string => {
    let j = i + 1;
    while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
    const raw = s.slice(i, j + 1);
    i = j + 1;
    return JSON.parse(raw) as string;
  };
  const val = (): ConfigValue => {
    ws();
    const at = line;
    const c = s[i];
    if (c === '{') {
      i++;
      const props = new Map<string, ConfigValue>();
      ws();
      if (s[i] === '}') {
        i++;
        return { t: 'obj', props, line: at, open: false };
      }
      for (;;) {
        ws();
        const keyLine = line;
        const k = str();
        ws();
        if (s[i++] !== ':') throw new Error('expected :');
        const v = val();
        if (props.has(k)) onDuplicate?.(k);
        props.set(k, { ...v, line: v.t === 'obj' || v.t === 'arr' ? keyLine : v.line });
        ws();
        if (s[i] === ',') i++;
        else if (s[i] === '}') {
          i++;
          return { t: 'obj', props, line: at, open: false };
        } else throw new Error('expected , or }');
      }
    }
    if (c === '[') {
      i++;
      const items: ConfigValue[] = [];
      ws();
      if (s[i] === ']') {
        i++;
        return { t: 'arr', items, line: at };
      }
      for (;;) {
        items.push(val());
        ws();
        if (s[i] === ',') i++;
        else if (s[i] === ']') {
          i++;
          return { t: 'arr', items, line: at };
        } else throw new Error('expected , or ]');
      }
    }
    if (c === '"') return { t: 'str', v: str(), line: at };
    const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(s.slice(i));
    if (!m) throw new Error('unexpected token');
    i += m[0].length;
    if (m[0] === 'true' || m[0] === 'false') return { t: 'bool', v: m[0] === 'true', line: at };
    if (m[0] === 'null') return { t: 'null', line: at };
    return { t: 'num', v: Number(m[0]), line: at };
  };
  try {
    const v = val();
    ws();
    return i === s.length ? v : null;
  } catch {
    return null;
  }
}

/**
 * The raw source text of every top-level member of a JSON object, located
 * without decoding any value: the safety net compares these slices byte for
 * byte. Anything that makes the location less than certain is an anomaly,
 * reported instead of guessed at: a byte-order mark or anything before the
 * object, invalid JSON (per RFC 8259, strictly), a key written with escapes,
 * a duplicate key at any depth, content after the object, or a U+FFFD
 * replacement character (bytes that were not valid UTF-8).
 */
export function rawTopLevelMembers(text: string): { members: Map<string, string> } | { anomaly: string } {
  const s = text;
  let i = 0;
  const fail = (why: string): never => {
    throw new Error(why);
  };
  const ws = (): void => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++;
  };
  const string = (): string => {
    if (s[i] !== '"') fail(`expected a string at offset ${i}`);
    const start = ++i;
    while (i < s.length && s[i] !== '"') {
      const c = s.charCodeAt(i);
      if (c < 0x20) fail(`control character in a string at offset ${i}`);
      if (s[i] === '\\') {
        const e = s[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) fail(`invalid \\u escape at offset ${i}`);
          i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
        else fail(`invalid escape at offset ${i}`);
      } else i++;
    }
    if (i >= s.length) fail('unterminated string');
    return s.slice(start, i++);
  };
  const value = (): void => {
    ws();
    const c = s[i];
    if (c === '{') return object(null);
    if (c === '[') {
      i++;
      ws();
      if (s[i] === ']') {
        i++;
        return;
      }
      for (;;) {
        value();
        ws();
        if (s[i] === ',') i++;
        else if (s[i] === ']') {
          i++;
          return;
        } else fail(`expected , or ] at offset ${i}`);
      }
    }
    if (c === '"') {
      string();
      return;
    }
    const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(s.slice(i));
    if (!m) fail(`unexpected token at offset ${i}`);
    i += m![0].length;
  };
  const object = (members: Map<string, string> | null): void => {
    i++; // {
    const seen = new Set<string>();
    ws();
    if (s[i] === '}') {
      i++;
      return;
    }
    for (;;) {
      ws();
      const key = string();
      if (key.includes('\\')) fail(`key "${key}" is written with escapes`);
      if (seen.has(key)) fail(`duplicate key "${key}"`);
      seen.add(key);
      ws();
      if (s[i++] !== ':') fail(`expected : at offset ${i - 1}`);
      ws();
      const start = i;
      value();
      members?.set(key, s.slice(start, i));
      ws();
      if (s[i] === ',') i++;
      else if (s[i] === '}') {
        i++;
        return;
      } else fail(`expected , or } at offset ${i}`);
    }
  };
  try {
    if (s.startsWith('\uFEFF')) fail('byte-order mark');
    if (s.includes('\uFFFD')) fail('bytes that are not valid UTF-8');
    ws();
    if (s[i] !== '{') fail('the root is not an object');
    const members = new Map<string, string>();
    object(members);
    ws();
    if (i !== s.length) fail(`content after the object at offset ${i}`);
    return { members };
  } catch (err) {
    return { anomaly: (err as Error).message };
  }
}
