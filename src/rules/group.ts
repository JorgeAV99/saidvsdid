// Several warnings with the same cause in the same file are reported as one (docs/rules.md, *Grouped findings*):
// the count, the first one's line, and every test in Finding.tests (the report renders the list folded).
//
// The cause is the finding's own message with the test it names left out: same rule, severity, file, side and reason,
// and the same words otherwise (`Removes test "a"` and `Removes test "b"`, `Adds \`it.skip\` … to test "a"`). A FAIL is
// never grouped: each one names the tests whose status the runner-evidence oracle reads (Finding.ids). An INFO line is not
// a warning and stays one per site: its line is what the nets and the invariant read (NEW_TEST).
import type { Finding } from './types.js';
import { listNames, quote } from './util.js';

const HOLE = '\u0001';

function causeOf(f: Finding): string | null {
  if (f.severity !== 'warn' || f.test === null || f.ids !== undefined) return null;
  const q = quote(f.test);
  return f.message.includes(q) ? f.message.split(q).join(HOLE) : null;
}

/** The message of a group of `names.length` findings with the same cause. */
function groupMessage(cause: string, names: string[]): string {
  const n = names.length;
  const text = cause
    .replace(new RegExp(`\\bnew test ${HOLE}`, 'g'), `${n} new tests`)
    .replace(new RegExp(`\\b[Tt]est ${HOLE}`, 'g'), `${n} tests`)
    .split(HOLE)
    .join(`${n} tests`)
    .replace(/\bit may not have been the runner's test\b/g, "they may not have been the runner's tests")
    .replace(/\bmay (skip|turn|make|focus) it\b/g, 'may $1 them')
    .replace(/\bthe local code this test used\b/g, 'the local code these tests used');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} (${listNames(names)})`;
}

/** The findings with every group of two or more same-cause findings in one file merged into one, in place of the first. */
export function groupFindings(findings: readonly Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  const keyOf = new Map<Finding, string>();
  for (const f of findings) {
    const cause = causeOf(f);
    if (cause === null) continue;
    const key = JSON.stringify([f.rule, f.severity, f.file, f.side, f.reason ?? null, cause]);
    keyOf.set(f, key);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const out: Finding[] = [];
  const done = new Set<string>();
  for (const f of findings) {
    const key = keyOf.get(f);
    const members = key === undefined ? undefined : groups.get(key);
    if (!key || !members || members.length < 2) {
      out.push(f);
      continue;
    }
    if (done.has(key)) continue;
    done.add(key);
    const names = [...new Set(members.flatMap((m) => m.tests ?? [m.test!]))];
    const lines = members.map((m) => m.line).filter((l): l is number => l !== null);
    out.push({
      rule: f.rule,
      severity: f.severity,
      file: f.file,
      side: f.side,
      line: lines.length > 0 ? Math.min(...lines) : null,
      test: null,
      message: groupMessage(causeOf(f)!, names),
      ...(f.reason !== undefined ? { reason: f.reason } : {}),
      tests: names,
      ...(members.some((m) => m.tampering) ? { tampering: true as const } : {}),
    });
  }
  return out;
}
