// Shell command lines as agents run them: unwrapping the launcher
// (`bash -lc '…'`, `powershell.exe -Command '…'`, `cmd /c …`), splitting on
// operators, and words. Deterministic and deliberately small: anything we
// cannot read (command substitution, unbalanced quotes) stays opaque text.

export type Dialect = 'posix' | 'powershell' | 'cmd';

/** The operator that joins a segment to the one before it. */
export type Operator = ';' | '&&' | '||' | '|' | '&' | '\n';

export interface Segment {
  text: string;
  /** Operator before this segment (null for the first). */
  before: Operator | null;
  /** Operator after this segment (null for the last). */
  after: Operator | null;
}

/** Splits a command line into words. Returns null on unbalanced quotes. */
export function words(text: string, dialect: Dialect = 'posix'): string[] | null {
  const out: string[] = [];
  let word = '';
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'" && dialect !== 'cmd') {
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === "'") {
          // PowerShell escapes a single quote by doubling it.
          if (dialect === 'powershell' && text[j + 1] === "'") {
            word += "'";
            j++;
            continue;
          }
          break;
        }
        word += text[j];
      }
      if (j >= text.length) return null;
      inWord = true;
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        const esc = dialect === 'powershell' ? '`' : dialect === 'posix' ? '\\' : null;
        if (esc && text[j] === esc && j + 1 < text.length && (dialect === 'powershell' || '"\\$`\n'.includes(text[j + 1]!))) j++;
        word += text[j];
      }
      if (j >= text.length) return null;
      inWord = true;
      i = j;
    } else if (c === '\\' && dialect === 'posix' && i + 1 < text.length) {
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

const basename = (w: string): string => w.slice(Math.max(w.lastIndexOf('/'), w.lastIndexOf('\\')) + 1);

/** Program name without directory, extension or case: `C:\…\powershell.exe` → `powershell`. */
export function programName(word: string): string {
  return basename(word).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
}

const POSIX_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const POWERSHELLS = new Set(['powershell', 'pwsh']);

/**
 * Strips the shell launcher an agent wraps its commands in, repeatedly.
 * `"C:\…\powershell.exe" -Command 'npm test'` → { inner: 'npm test', dialect: 'powershell' }.
 */
export function unwrap(command: string, dialect: Dialect = 'posix'): { inner: string; dialect: Dialect } {
  let inner = command.trim();
  let current = dialect;
  for (let depth = 0; depth < 4; depth++) {
    const w = words(inner, current === 'cmd' ? 'posix' : current);
    if (!w || w.length < 2) break;
    const prog = programName(w[0]!);
    if (POSIX_SHELLS.has(prog)) {
      let i = 1;
      while (i < w.length && /^-[a-z]+$/.test(w[i]!) && !w[i]!.includes('c')) i++;
      if (i < w.length && /^-[a-z]*c[a-z]*$/.test(w[i]!) && i + 2 === w.length) {
        inner = w[i + 1]!;
        current = 'posix';
        continue;
      }
    } else if (POWERSHELLS.has(prog)) {
      let i = 1;
      while (i < w.length && /^-(NoProfile|NoLogo|NonInteractive|ExecutionPolicy|InputFormat|OutputFormat)$/i.test(w[i]!)) {
        i += /^-(ExecutionPolicy|InputFormat|OutputFormat)$/i.test(w[i]!) ? 2 : 1;
      }
      if (i < w.length && /^-(Command|c)$/i.test(w[i]!) && i + 1 < w.length) {
        inner = w.length === i + 2 ? w[i + 1]! : w.slice(i + 1).join(' ');
        current = 'powershell';
        continue;
      }
    } else if (prog === 'cmd') {
      let i = 1;
      while (i < w.length && /^\/[dsq]$/i.test(w[i]!)) i++;
      if (i < w.length && /^\/[ck]$/i.test(w[i]!) && i + 1 < w.length) {
        inner = w.slice(i + 1).join(' ');
        current = 'cmd';
        continue;
      }
    }
    break;
  }
  return { inner, dialect: current };
}

/**
 * Splits on `;`, `&&`, `||`, `|`, `&` and newlines outside quotes. Redirections
 * (`2>&1`, `&>`, `>&2`) are not operators; in PowerShell `&` is the call
 * operator and in cmd it separates commands like `;`.
 */
export function segments(command: string, dialect: Dialect): Segment[] {
  const parts: { text: string; before: Operator | null }[] = [];
  let current = '';
  let before: Operator | null = null;
  let quote: string | null = null;
  const push = (op: Operator): void => {
    parts.push({ text: current, before });
    current = '';
    before = op;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    const next = command[i + 1];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && ((c === '\\' && dialect === 'posix') || (c === '`' && dialect === 'powershell'))) {
        current += c + (next ?? '');
        i++;
        continue;
      }
      current += c;
      continue;
    }
    if (c === "'" && dialect !== 'cmd') quote = c;
    else if (c === '"') quote = c;
    if (quote) {
      current += c;
      continue;
    }
    if (c === '\\' && dialect === 'posix' && next !== undefined) {
      current += c + next;
      i++;
    } else if (c === '&' && next === '&') {
      push('&&');
      i++;
    } else if (c === '|' && next === '|') {
      push('||');
      i++;
    } else if (c === '|') {
      push('|');
      if (next === '&') i++; // bash `|&`
    } else if (c === ';' || c === '\n') {
      push(c);
    } else if (c === '&') {
      const prev = current.trimEnd().slice(-1);
      if (prev === '>' || next === '>' || dialect === 'powershell') current += c;
      else push(dialect === 'cmd' ? ';' : '&');
    } else current += c;
  }
  parts.push({ text: current, before });
  const out: Segment[] = [];
  for (const p of parts) {
    const text = p.text.trim().replace(/^\(\s*/, '').replace(/\s*\)$/, '');
    if (text === '') {
      // `a; ; b`, a trailing `;` or `&`: keep the stronger operator on the next segment.
      if (p.before === '&' && out.length > 0) out[out.length - 1]!.after = '&';
      continue;
    }
    const prev = out[out.length - 1];
    const op = prev ? p.before : null;
    if (prev) prev.after = op;
    out.push({ text, before: op, after: null });
  }
  return out;
}

export interface Redirect {
  /** File descriptor or `&` for `&>`. */
  fd: string;
  target: string;
}

const REDIRECT = /(\d|&)?>>?\s*(&\d|[^\s;&|<>]+)/g;
const INPUT = /<\s*[^\s;&|<>]+/g;

/**
 * Hides quoted strings and `<REPO>`-style markers (left by the session
 * recorder's sanitiser) from the redirection patterns: `grep "a > b"` and
 * `cd "<REPO>"` redirect nothing.
 */
function masked(text: string): { text: string; restore: (s: string) => string } {
  const saved: string[] = [];
  const out = text.replace(/"(?:[^"\\]|\\.)*"|'[^']*'|<[A-Z][A-Z_]*>/g, (m) => `\u0000${saved.push(m) - 1}\u0000`);
  return { text: out, restore: (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => saved[Number(i)]!) };
}

/** Output redirections in a segment (`> out.txt`, `2>>log`, `&> x`); `2>&1`-style duplications are not files. */
export function redirects(segmentText: string): Redirect[] {
  const { text, restore } = masked(segmentText);
  const out: Redirect[] = [];
  for (const m of text.matchAll(REDIRECT)) {
    const target = restore(m[2]!).replace(/^["']|["']$/g, '');
    if (target.startsWith('&')) continue;
    out.push({ fd: m[1] ?? '1', target });
  }
  return out;
}

/** A redirection target that is not a file in the repository. */
export function isNullDevice(target: string): boolean {
  return /^(\/dev\/(null|stdout|stderr)|nul|\$null)$/i.test(target);
}

/** Words of a segment without redirections and leading `VAR=value` assignments. */
export function commandWords(segmentText: string, dialect: Dialect): string[] | null {
  const { text, restore } = masked(segmentText);
  const w = words(restore(text.replace(REDIRECT, ' ').replace(INPUT, ' ')), dialect);
  if (!w) return null;
  let i = 0;
  while (i < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]!)) i++;
  // PowerShell call operator and `env X=1 cmd`
  if (dialect === 'powershell' && w[i] === '&') i++;
  return w.slice(i);
}
