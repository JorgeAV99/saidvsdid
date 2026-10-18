import type { MarkerCondition } from './types.js';

// A skip/xfail condition that only mentions the platform, runtime, browser or
// environment is the canonical *legitimate* conditional skip ("not supported on
// Windows"). Anything else is reported as an opaque condition.
const ENVIRONMENT_RE = new RegExp(
  [
    String.raw`\bprocess\.(?:platform|arch|env|version|versions|release)\b`,
    String.raw`\bos\.(?:platform|type|arch|release|name|environ|getenv|uname)\b`,
    String.raw`\bplatform\.(?:system|machine|python_implementation|platform|release|mac_ver|win32_ver)\b`,
    String.raw`\bsys\.(?:platform|version_info|implementation|maxsize|pypy_version_info)\b`,
    String.raw`\b(?:browserName|isMobile|channel|headless|navigator\.userAgent)\b`,
    String.raw`\b(?:is|IS_)(?:Windows|Win|WINDOWS|WIN|Mac|MAC|MacOS|MACOS|Darwin|DARWIN|Linux|LINUX|CI|Ci)\b`,
    String.raw`\b(?:shutil\.which|find_spec|importorskip|find_library)\b`,
    String.raw`\btypeof\s+(?:window|document|Deno|Bun)\b`,
  ].join('|'),
);

/**
 * One condition guarding a marker. `negated` means the marker applies when the
 * expression is *false*: `runIf(c)`, `skipUnless(c)`, the `else` branch of
 * `if (c)`, the right side of `c || skip()`.
 */
export interface Guard {
  text: string;
  negated: boolean;
  /** Its truth value when the language's own tooling read it as a literal (Python's `ast.literal_eval`). */
  value?: boolean;
}

const TRUE_LITERALS = new Set(['true', 'True', '1']);
const FALSE_LITERALS = new Set(['false', 'False', '0', 'None', 'null', 'undefined', '""', "''"]);

/** Constant value of a literal expression (with parentheses and `!`/`not`), or null if not constant. */
export function constantValue(text: string): boolean | null {
  let t = text.trim();
  while (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1).trim();
  if (t.startsWith('!')) {
    const v = constantValue(t.slice(1));
    return v === null ? null : !v;
  }
  if (/^not\s/.test(t)) {
    const v = constantValue(t.slice(4));
    return v === null ? null : !v;
  }
  if (TRUE_LITERALS.has(t)) return true;
  if (FALSE_LITERALS.has(t)) return false;
  return null;
}

/**
 * Classifies the guards of a marker. Returns null when a guard is constantly
 * false (after polarity), i.e. the marker can never apply.
 */
export function classifyGuards(guards: Guard[]): MarkerCondition | null {
  let environment = false;
  let opaque = false;
  for (const g of guards) {
    const value = g.value ?? constantValue(g.text);
    if (value !== null) {
      if ((g.negated ? !value : value) === false) return null;
      continue;
    }
    if (ENVIRONMENT_RE.test(g.text)) environment = true;
    else opaque = true;
  }
  if (opaque) return 'conditional';
  if (environment) return 'environment';
  return 'unconditional';
}

export function snippet(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export function normaliseBody(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
