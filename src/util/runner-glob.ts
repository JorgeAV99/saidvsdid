// Glob dialects of the test runners, compiled to regular expressions over
// repo-relative paths ("tests/unit/a.test.ts").
//
// Each compiler returns null for syntax it does not reproduce exactly
// (negations, `!(...)`, numeric ranges), so callers can treat the result as
// uncertain instead of guessing.

function escape(c: string): string {
  return c.replace(/[.+^${}()|[\]\\/]/g, '\\$&');
}

/** Expands `{a,b}` alternatives (nested allowed). Null for `{1..3}` ranges or unbalanced braces. */
export function expandBraces(pattern: string): string[] | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth < 0) return null;
      if (depth === 0) {
        const body = pattern.slice(start + 1, i);
        if (/^-?\w+\.\.-?\w+/.test(body)) return null;
        const parts: string[] = [];
        let d = 0;
        let from = 0;
        for (let j = 0; j < body.length; j++) {
          if (body[j] === '{') d++;
          else if (body[j] === '}') d--;
          else if (body[j] === ',' && d === 0) {
            parts.push(body.slice(from, j));
            from = j + 1;
          }
        }
        parts.push(body.slice(from));
        if (parts.length === 1) continue; // `{a}` is literal in picomatch; keep scanning
        const out: string[] = [];
        for (const p of parts) {
          const rest = expandBraces(pattern.slice(0, start) + p + pattern.slice(i + 1));
          if (!rest) return null;
          out.push(...rest);
        }
        return out;
      }
    }
  }
  return depth === 0 ? [pattern] : null;
}

/** Index of the `)` closing the group opened at `open`, or -1. */
function closing(p: string, open: number): number {
  let depth = 0;
  for (let i = open; i < p.length; i++) {
    if (p[i] === '\\') i++;
    else if (p[i] === '(') depth++;
    else if (p[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** One brace-free picomatch pattern → regex source (no anchors). Null if unsupported. */
function picoSource(p: string): string | null {
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    const next = p[i + 1];
    if ('?*+@!'.includes(c) && next === '(') {
      if (c === '!') return null;
      const end = closing(p, i + 1);
      if (end === -1) return null;
      const alts = splitTop(p.slice(i + 2, end)).map(picoSource);
      if (alts.some((a) => a === null)) return null;
      const group = `(?:${alts.join('|')})`;
      re += c === '?' ? `${group}?` : c === '*' ? `${group}*` : c === '+' ? `${group}+` : group;
      i = end;
    } else if (c === '*') {
      if (next === '*') {
        const atStart = i === 0 || p[i - 1] === '/';
        const atEnd = i + 2 === p.length || p[i + 2] === '/';
        if (atStart && atEnd) {
          // `**` as a whole segment: any number of directories.
          if (p[i + 2] === '/') {
            re += '(?:[^/]*/)*';
            i += 2;
          } else {
            re += '.*';
            i += 1;
          }
          continue;
        }
        re += '[^/]*';
        i += 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const end = p.indexOf(']', i + 2);
      if (end === -1) return null;
      let body = p.slice(i + 1, end);
      if (body.startsWith('!') || body.startsWith('^')) body = `^${body.slice(1)}`;
      if (body.includes('[:')) return null; // POSIX classes
      re += `[${body.replace(/\\(?!\])/g, '\\\\')}]`;
      i = end;
    } else if (c === '\\') {
      re += escape(p[i + 1] ?? '');
      i++;
    } else if (c === '/' && p.slice(i + 1) === '**' && i > 0) {
      // A trailing `/**` also matches the directory itself.
      re += '(?:/.*)?';
      break;
    } else {
      re += escape(c);
    }
  }
  return re;
}

function splitTop(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')') depth--;
    else if (body[i] === '|' && depth === 0) {
      out.push(body.slice(from, i));
      from = i + 1;
    }
  }
  out.push(body.slice(from));
  return out;
}

/**
 * picomatch with `dot: true`, as used by Vitest (tinyglobby) and Jest
 * (micromatch) for `include`/`exclude`/`testMatch`. The pattern is matched
 * against the whole relative path.
 */
export function picomatchRegExp(pattern: string): RegExp | null {
  let p = pattern.replace(/\\/g, '/');
  if (p.startsWith('!')) return null;
  while (p.startsWith('./')) p = p.slice(2);
  const expanded = expandBraces(p);
  if (!expanded) return null;
  const sources = expanded.map(picoSource);
  if (sources.some((s) => s === null)) return null;
  return new RegExp(`^(?:${sources.join('|')})$`);
}

/**
 * Python's fnmatch: `*` matches any characters including `/`, `?` one
 * character, `[seq]` / `[!seq]` a class. Case-sensitive (POSIX).
 */
export function fnmatchRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end === -1) {
        re += '\\[';
        continue;
      }
      let body = pattern.slice(i + 1, end);
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      re += `[${body.replace(/\\/g, '\\\\')}]`;
      i = end;
    } else re += escape(c);
  }
  return new RegExp(`^${re}$`, 's');
}
