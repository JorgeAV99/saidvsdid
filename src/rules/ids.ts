// The identity of a test, as the runners report it and the runner-evidence recorder keys it
// (scripts/runner-evidence.mjs): structured, never a concatenated string — its file, its full name, and its ordinal
// among the file's tests with the same name (1, 2…), in the order the file declares them. A title `X#2` and the second
// test titled `X` are different identities. Python binds a name once (a second `def` replaces the first, and F7 makes
// such a test a WARN): its tests' ordinal is 1.
import type { LanguageId } from '../parse/types.js';

/** A test's identity within its file: its full name and its ordinal (1 for the first test of that name). */
export type TestId = [name: string, ordinal: number];

/** The ordinal of each of a file's tests, in declaration order. */
export function testOrdinals(names: readonly string[], language: LanguageId): number[] {
  if (language === 'python') return names.map(() => 1);
  const seen = new Map<string, number>();
  return names.map((name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n;
  });
}

/** How many of the file's tests have `name` (≥ 2: which one a runner reports is not certain). */
export function sameName(tests: readonly { name: string }[], name: string): number {
  return tests.filter((t) => t.name === name).length;
}
