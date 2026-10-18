// What a FAIL does to the tests, as the real runner shows it: the oracle of the fixtures reads it
// (test/runner-evidence.test.ts) and asks the runner for the matching evidence (fixtures/oracle.ts).
//
// A rule gives a FAIL only when the base runner guarantees its effect and the oracle can show it with the real runner
// (docs/rules.md, *Verdicts*). Two effects qualify:
// - `not-run`: the runner reports the tests as not run (skipped, a body-less todo, focused away, not collected).
// - `expected-failure`: the runner still runs the test and reports it as an expected failure, by its explicit signal:
//   xfailed when its body fails, xpassed when it passes (pytest's xfail, unittest's expectedFailure, Vitest's `fails`,
//   Jest's `failing`, Playwright's `fail`, node:test's todo). Never a bare `failed`: a test broken by the code fails too.
// Any other effect (a test that checks less: TG004), or one that depends on a context, a condition, a plugin, a flag or
// a configuration, gives a WARN.
import type { RunnerPackage } from '../parse/ts-binding.js';
import type { MarkerKind } from '../parse/types.js';
import { nameTable } from '../util/names.js';
import type { RuleId } from './types.js';

export type FailEffect = 'not-run' | 'expected-failure';

/** The runners whose markers can give a FAIL: the JS packages and Python's two. */
export type EffectRunner = RunnerPackage | 'pytest' | 'unittest';

/**
 * The effect of a FAIL of each rule that can give one. TG003's FAIL carries its marker's (MARKER_FAIL_EFFECT): its entry
 * here is the default the fixtures leave unwritten. TG004 has none: it is never a FAIL.
 */
export const RULE_FAIL_EFFECT: Readonly<Partial<Record<RuleId, FailEffect>>> = nameTable('RULE_FAIL_EFFECT', {
  TG001: 'not-run',
  TG002: 'not-run',
  TG003: 'not-run',
});

/**
 * The effect of each kind of marker (TG003), by runner, as the real runner shows it; a kind a runner has no entry for
 * gives no FAIL. Each entry has fixtures whose runner evidence shows it (test/runner-evidence.test.ts):
 * - Vitest: `skip`, `skipIf`/`runIf` and `todo` (its body is never run) are not run; `fails` is an expected failure.
 * - Jest: `skip`, `xit`/`xtest`/`xdescribe` and `todo` (it takes no body) are not run; `failing` is an expected failure.
 * - Playwright: `skip` and `fixme` are not run; `fail` is an expected failure.
 * - node:test: `skip` is reported skipped and its outcome ignored (`t.skip()` lets the rest of the body run: Node reports
 *   it skipped all the same); `todo` — `test.todo`, `{ todo: true }`, `t.todo()`, `describe.todo` — runs the body and
 *   tolerates its failure, reported as todo: an expected failure.
 * - pytest: `skip`/`skipif`/`pytest.skip()`/`importorskip` are not run; `xfail` and `pytest.xfail()` are an expected
 *   failure, `xfail(run=False)` is not run (src/parse/py.ts sets it on the marker).
 * - unittest: `skip`/`skipIf`/`skipUnless`/`SkipTest`/`skipTest` are not run; `expectedFailure` on a method of a
 *   `unittest.TestCase` subclass is an expected failure (anywhere else the parser gives it no effect).
 */
export const MARKER_FAIL_EFFECT: Readonly<Record<EffectRunner, Readonly<Partial<Record<MarkerKind, FailEffect>>>>> = nameTable('MARKER_FAIL_EFFECT', {
  vitest: nameTable('MARKER_FAIL_EFFECT.vitest', { skip: 'not-run', todo: 'not-run', xfail: 'expected-failure' }),
  '@jest/globals': nameTable('MARKER_FAIL_EFFECT.jest', { skip: 'not-run', todo: 'not-run', xfail: 'expected-failure' }),
  '@playwright/test': nameTable('MARKER_FAIL_EFFECT.playwright', { skip: 'not-run', fixme: 'not-run', xfail: 'expected-failure' }),
  'node:test': nameTable('MARKER_FAIL_EFFECT.node-test', { skip: 'not-run', todo: 'expected-failure' }),
  pytest: nameTable('MARKER_FAIL_EFFECT.pytest', { skip: 'not-run', xfail: 'expected-failure' }),
  unittest: nameTable('MARKER_FAIL_EFFECT.unittest', { skip: 'not-run', xfail: 'expected-failure' }),
});

/** What a marker does to the tests, when its runner guarantees it, or why it gives no FAIL. */
export type MarkerEffect = { known: true; effect: FailEffect } | { known: false; why: string };

/** The effect of a marker of `kind` of `runner` (null: the runner is not certain), from MARKER_FAIL_EFFECT. */
export function markerEffect(runner: EffectRunner | null, kind: MarkerKind): MarkerEffect {
  if (runner === null) return { known: false, why: 'its runner is not certain' };
  const effect = MARKER_FAIL_EFFECT[runner][kind];
  return effect === undefined ? { known: false, why: `${runner} guarantees no effect of \`${kind}\`` } : { known: true, effect };
}
