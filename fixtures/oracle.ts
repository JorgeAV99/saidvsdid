// What the real runner must show for each kind of FAIL (src/rules/effects.ts): the oracle test/runner-evidence.test.ts
// holds every fixture to, independently of saidvsdid's own analysis.
import type { FailEffect } from '../src/rules/effects.js';
import type { RunnerStatus } from './build.js';
import type { TestId } from '../src/rules/ids.js';
import { ownRecord } from '../src/util/names.js';

export type Statuses = Readonly<Record<string, RunnerStatus>>;

/**
 * Statuses of a test the runner ran: an expected failure ran too, whether its body failed (xfailed) or passed
 * (xpassed): passed → xpassed is a test that still runs, never evidence that it stopped.
 */
export const RAN: ReadonlySet<RunnerStatus> = new Set(['passed', 'failed', 'xfailed', 'xpassed']);

/** The runner's explicit signal for an expected failure: never a bare `failed`, which a broken test gives too. */
export const EXPECTED_FAILURE: ReadonlySet<RunnerStatus> = new Set(['xfailed', 'xpassed']);

/**
 * A side's statuses as a lookup table of its own keys alone: a test titled `constructor` or `toString` is a test, and
 * no test is inherited from `Object.prototype` (src/util/names.ts).
 */
function own(statuses: Statuses): { has: (t: string) => boolean; get: (t: string) => RunnerStatus | undefined; tests: string[] } {
  const table = ownRecord(statuses);
  return { has: (t) => Object.hasOwn(table, t), get: (t) => (Object.hasOwn(table, t) ? table[t] : undefined), tests: Object.keys(table) };
}

/**
 * Tests that ran at base and no longer run at head: still collected but skipped or focused away, or not collected at
 * all (a narrowed scope). A test that vanishes while a new one appears may have been renamed, so vanished tests only
 * count beyond the number of new ones.
 */
export function lostTests(baseStatuses: Statuses, headStatuses: Statuses): string[] {
  const base = own(baseStatuses);
  const head = own(headStatuses);
  const ranAtBase = base.tests.filter((t) => RAN.has(base.get(t)!));
  const stopped = ranAtBase.filter((t) => head.has(t) && !RAN.has(head.get(t)!));
  const vanished = ranAtBase.filter((t) => !head.has(t));
  const appeared = head.tests.filter((t) => !base.has(t)).length;
  return [...stopped, ...(vanished.length > appeared ? vanished : [])];
}

/**
 * Tests the runner reports at head as an expected failure, explicitly (xfailed or xpassed), that were not one at base:
 * xpassed → xfailed is the same expected failure, its body changed, not a new one.
 */
export function expectedFailures(baseStatuses: Statuses, headStatuses: Statuses): string[] {
  const base = own(baseStatuses);
  const head = own(headStatuses);
  return head.tests.filter((t) => EXPECTED_FAILURE.has(head.get(t)!) && !EXPECTED_FAILURE.has(base.get(t)!));
}

/**
 * The evidence a FAIL of an effect needs, or null when the runner shows it. With `tests`, only the status of those
 * tests counts (the tests the finding names, test/runner-evidence.test.ts): a FAIL is never credited with another
 * test's evidence. Without, any test of the fixture (a negative control).
 */
export function missingEvidence(effect: FailEffect, baseStatuses: Statuses, headStatuses: Statuses, tests?: readonly string[]): string | null {
  const base = own(baseStatuses);
  const head = own(headStatuses);
  const named = tests ? ` (${tests.join(', ') || 'no test of the runner'})` : '';
  switch (effect) {
    case 'not-run': {
      const lost = tests ? tests.filter((t) => base.has(t) && RAN.has(base.get(t)!) && !(head.has(t) && RAN.has(head.get(t)!))) : lostTests(baseStatuses, headStatuses);
      return lost.length > 0 ? null : `a FAIL that stops tests running must correspond to tests the runner no longer runs${named}`;
    }
    case 'expected-failure': {
      const fresh = expectedFailures(baseStatuses, headStatuses).filter((t) => !tests || tests.includes(t));
      return fresh.length > 0 ? null : `a FAIL that makes a test an expected failure needs the runner to report it as a new one (xfailed or xpassed, and not one at base), not a bare failure${named}`;
    }
  }
}

/** A recorded key read back as the identity it is (scripts/runner-evidence.mjs): [file, name, ordinal], or null. */
export function parseKey(key: string): [file: string, name: string, ordinal: number] | null {
  try {
    const v: unknown = JSON.parse(key);
    return Array.isArray(v) && v.length === 3 && typeof v[0] === 'string' && typeof v[1] === 'string' && Number.isInteger(v[2]) ? [v[0], v[1], v[2] as number] : null;
  } catch {
    return null;
  }
}

/**
 * The runner's keys for the test `id` (name, ordinal; Finding.ids, src/rules/ids.ts) of `file`, as the recorder keys
 * them: the key whose file, name and ordinal are those — and, for pytest, the parametrised ids `name[x]` of the same
 * test. When the runner reports more than one test of that name in the file (an ordinal above 1 on either side), which
 * one is the finding's is not certain: no key, the oracle never credits it.
 */
export function runnerKeys(runner: string, file: string, id: TestId, statuses: readonly Statuses[]): string[] {
  const [name, ordinal] = id;
  const same = new Set<string>();
  for (const s of statuses) {
    for (const k of Object.keys(ownRecord(s))) {
      const key = parseKey(k);
      if (key && key[0] === file && (key[1] === name || (runner === 'pytest' && key[1].startsWith(`${name}[`)))) same.add(k);
    }
  }
  if ([...same].some((k) => parseKey(k)![2] !== 1)) return [];
  return [...same].filter((k) => parseKey(k)![2] === ordinal);
}

/**
 * What a FAIL's identities lack, each on its own (a correct loss never hides a false one), or [] when every one has
 * its evidence: the FAIL names at least one; each identity maps to at least one of the runner's results (a parametrised
 * test to each of its cases), to none another identity maps to, and each of those results shows the effect.
 */
export function identityProblems(effect: FailEffect, runner: string, file: string, ids: readonly TestId[], base: Statuses, head: Statuses): string[] {
  if (ids.length === 0) return ['the FAIL names no test'];
  const keysOf = ids.map((id) => runnerKeys(runner, file, id, [base, head]));
  const out: string[] = [];
  ids.forEach((id, i) => {
    const keys = keysOf[i]!;
    if (keys.length === 0) return void out.push(`${JSON.stringify(id)} is no test the runner reports`);
    if (keys.some((k) => keysOf.some((other, j) => j !== i && other.includes(k)))) return void out.push(`${JSON.stringify(id)} cannot be told apart from another identity`);
    for (const k of keys) {
      const missing = missingEvidence(effect, base, head, [k]);
      if (missing) out.push(`${JSON.stringify(id)} (${k}): ${missing}`);
    }
  });
  return out;
}
