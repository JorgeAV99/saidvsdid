import type { Binding, Marker, MarkerCondition, MarkerKind, TestCase } from '../parse/index.js';
import type { Severity } from './types.js';

/** How strongly a marker applies. Higher is stronger. */
export const DISABLE_LEVEL: Record<MarkerCondition | 'none', number> = {
  none: 0,
  environment: 1,
  conditional: 2,
  unconditional: 3,
};

export const DISABLING_KINDS = new Set(['skip', 'todo', 'fixme', 'xfail']);

/**
 * Finding.reason of an INFO line about a disabling marker (skip, todo, fixme, expected failure) on tests that did
 * not exist at base: nothing that existed is lost, so it is never a warning. The nets read it (src/check.ts).
 */
export const NEW_TEST = 'new_test';

export function disablingMarkers(test: TestCase): Marker[] {
  return test.markers.filter((m) => DISABLING_KINDS.has(m.kind));
}

function strongest(markers: Marker[]): number {
  return Math.max(0, ...markers.map((m) => DISABLE_LEVEL[m.condition]));
}

/**
 * How strongly the test is kept from being verified at all: skip / todo /
 * fixme / non-strict xfail. The test either does not run or cannot fail.
 * `certainOnly`: only markers certainly the runner's (see Binding).
 */
export function hiddenLevel(test: TestCase, certainOnly = false): number {
  return strongest(disablingMarkers(test).filter((m) => !m.checked && (!certainOnly || m.binding.certain)));
}

/**
 * How strongly the test is inverted into a checked expected failure
 * (`it.fails`, `xfail(strict=True)`): it still runs and an unexpected pass
 * fails the suite, so it is weaker than a normal test but stronger than a skip.
 */
export function invertedLevel(test: TestCase, certainOnly = false): number {
  return strongest(disablingMarkers(test).filter((m) => m.checked && (!certainOnly || m.binding.certain)));
}

/** The first uncertain binding among `bindings`, or certain. */
export function weakestOf(bindings: Iterable<Binding>): Binding {
  for (const b of bindings) if (!b.certain) return b;
  return { certain: true };
}

/** The reason an uncertain binding gives, for a WARN's wording; '' when certain. */
export function why(b: Binding): string {
  return b.certain ? '' : b.why;
}

/** What a marker of `kind` may do, for a WARN that is not certain: "may skip it". */
/** What a marker may do to its tests, said of `them` ("it may skip it", "it may make them an expected failure"). */
export const MAY: Record<MarkerKind, (them: string) => string> = {
  skip: (o) => `may skip ${o}`,
  todo: (o) => `may turn ${o} into a todo`,
  fixme: (o) => `may skip ${o} (fixme)`,
  xfail: (o) => `may make ${o} an expected failure`,
  only: (o) => `may focus ${o}`,
};

export function focusMarkers(test: TestCase): Marker[] {
  return test.markers.filter((m) => m.kind === 'only');
}

export function quote(name: string): string {
  return JSON.stringify(name);
}

export function listNames(names: string[], max = 5): string {
  const shown = names.slice(0, max).map(quote).join(', ');
  return names.length > max ? `${shown} (+${names.length - max} more)` : shown;
}

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, fail: 2 };

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
