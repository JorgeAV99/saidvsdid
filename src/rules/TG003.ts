// TG003: a test that used to run is now skipped / todo / fixme / expected to
// fail, or a new test is added already disabled.
//
// Two dimensions are compared, not one level: whether the test is *hidden*
// (skip, todo, fixme, non-strict xfail: nothing is verified) and whether it is
// *inverted* (strict expected failure: it runs and must fail). `it.fails` →
// `it.skip` keeps the same level but moves from inverted to hidden, which is a
// loss of verification.
//
// Severity follows certainty (docs/rules.md, *Attribution*, *Verdicts*): FAIL only
// for an unconditional marker that is certainly the runner's, written in a
// canonical form (Marker.form), whose effect that runner guarantees
// (src/rules/effects.ts: not run, or an expected failure), on a test that
// existed and was certainly the runner's at base; one effect per test (a
// canonical not-run marker leaves an expected failure a WARN), and an expected
// failure only on a test that was not one at base. A marker shaped like the runner's
// but not certain (a global, a local wrapper, a parameter, a helper's export,
// `pytest` rebound in the module, an overridden `self.skipTest`) is a
// WARN of this rule that says it "may" apply and why. Every other new marker
// is at least WARN (see census.ts), so a diff that adds a marker never passes.
//
// Messages describe the code, not its effect: "adds `it.skip` to test …",
// "changes the condition of `it.skipIf(true)` on test …".
import { runningAtBase } from './TG002.js';
import type { Marker, MarkerCondition, MarkerKind } from '../parse/index.js';
import { newMarkerSites, uncoveredSiteFindings } from './census.js';
import type { TestId } from './ids.js';
import { SiteGroups, headTests, siteKey, type Site } from './sites.js';
import type { Finding, Rule, Severity } from './types.js';
import { DISABLE_LEVEL, MAY, NEW_TEST, disablingMarkers, hiddenLevel, invertedLevel, listNames, weakestOf } from './util.js';

const DISABLING: ReadonlySet<MarkerKind> = new Set(['skip', 'todo', 'fixme', 'xfail']);

const CONDITION_LABEL: Record<MarkerCondition, string> = {
  unconditional: 'unconditional',
  environment: 'platform/environment condition',
  conditional: 'opaque condition',
};

function kindLabel(m: Marker): string {
  if (m.kind !== 'xfail') return m.kind;
  return m.checked ? 'expected failure' : 'expected failure, not checked';
}

/** What the marker is written on: the test, or the suite or file that declares the tests. */
function target(site: Site): string {
  const names = site.tests.map((t) => t.test.name);
  const fresh = site.tests.filter((t) => t.base === null).length;
  const added = fresh === site.tests.length ? 'new ' : '';
  const plural = names.length === 1 ? '' : 's';
  const newOnes = fresh > 0 && fresh < site.tests.length ? ` (${fresh} new)` : '';
  if (site.marker.scope === 'test') return `${added}test${plural} ${listNames(names)}`;
  const where = site.marker.scope === 'suite' ? 'a suite' : 'the file';
  return `${where} that declares ${names.length} ${added}test${plural}${newOnes}: ${listNames(names)}`;
}

export const TG003: Rule = {
  id: 'TG003',
  title: 'New skip / xfail / todo / fixme',
  run(ctx) {
    const groups = new SiteGroups();
    /** Sites whose tests were hidden at base only by markers that are not certainly the runner's. */
    const possiblyHiddenAtBase = new Map<string, string>();
    // The tests the file's focus let run at base (TG002's model: a nested focus narrows its ancestor's). A test another
    // focus left out at base may not have run: its new skip is a WARN, whatever the runner (the 0.2.0 audit's design review).
    const ranAtBase = runningAtBase(ctx);
    for (const ht of headTests(ctx)) {
      const base = ht.base;
      // One effect per test (docs/rules.md, *Verdicts*, F6): any other marker on the test, whatever its form or
      // certainty, leaves an expected failure a WARN (which of them decides is the runner's).
      const otherThan = (m: Marker): Marker | undefined => disablingMarkers(ht.test).find((o) => o !== m && o.site !== m.site);
      // A new expected failure only: a test that was one at base already is not made one.
      const wasExpected = base ? disablingMarkers(base).find((m) => m.kind === 'xfail' || (m.effect.known && m.effect.effect === 'expected-failure')) : undefined;
      for (const marker of disablingMarkers(ht.test)) {
        // A hidden marker only matters if the test was less hidden before; an
        // inverted one only if the test previously ran normally at that level.
        const level = DISABLE_LEVEL[marker.condition];
        const threshold = !base ? 0 : marker.checked ? Math.max(hiddenLevel(base), invertedLevel(base)) : hiddenLevel(base);
        if (level <= threshold) {
          // At base the test was hidden at this level only through markers that may not have applied,
          // and now through one that certainly does: the binding changed, not the marker.
          const certainThreshold = !base ? 0 : marker.checked ? Math.max(hiddenLevel(base, true), invertedLevel(base, true)) : hiddenLevel(base, true);
          if (base && marker.binding.certain && ht.test.binding.certain && level > certainThreshold) {
            groups.add(ht.file, marker, 'warn', ht);
            const prior = weakestOf(disablingMarkers(base).map((m) => m.binding));
            possiblyHiddenAtBase.set(siteKey(ht.file, marker), prior.certain ? '' : prior.why);
          }
          continue;
        }
        // FAIL only with certainty: the marker, the test at head and at base are the runner's, and the runner
        // guarantees the marker's effect (src/rules/effects.ts).
        const certain = marker.binding.certain && ht.test.binding.certain && base !== null && base.binding.certain;
        // A platform/environment condition is usually legitimate, but a newly
        // disabled test still has to be looked at: WARN, not FAIL.
        const why = !marker.form.canonical
          ? marker.form.why
          : base !== null && !ranAtBase.has(base)
            ? 'another test of the file is focused at base, so it may not have run'
          : ht.baseSameName > 1
            ? `the file declared ${ht.baseSameName} tests named ${JSON.stringify(base!.name)} at base, so which one the runner reported is not certain`
          : !marker.effect.known
            ? marker.effect.why
            : marker.effect.effect === 'expected-failure' && otherThan(marker)
              ? `\`${otherThan(marker)!.text}\` also applies to it, and the runner decides which of the two takes effect`
              : marker.effect.effect === 'expected-failure' && wasExpected
                ? `the test was already an expected failure at base (\`${wasExpected.text}\`)`
                : null;
        const severity: Severity = marker.condition === 'unconditional' && certain && why === null ? 'fail' : 'warn';
        groups.add(ht.file, marker, severity, ht, why);
      }
    }

    // Marker sites that already existed at base (same structural id): their condition changed.
    const baseOf = new Map<string, string>();
    for (const [basePath, headPath] of ctx.renames) baseOf.set(headPath, basePath);
    const existedAtBase = (file: string, marker: Marker): boolean =>
      ctx.base.files.get(baseOf.get(file) ?? file)?.markerSites.some((s) => s.site === marker.site) ?? false;

    const findings = groups.all().map((site): Finding => {
      const names = site.tests.map((t) => t.test.name);
      const m = site.marker;
      const wasInverted = site.tests.filter((t) => t.base && invertedLevel(t.base) > 0).length;
      const note = wasInverted > 0 && !m.checked ? ' (at base: a strict expected failure)' : '';
      const label = `(${kindLabel(m)}, ${CONDITION_LABEL[m.condition]})`;
      const key = siteKey(site.file, m);
      // Not certain: the marker or a test's declaration may not be the runner's.
      const doubt = weakestOf([m.binding, ...site.tests.map((t) => t.test.binding), ...site.tests.flatMap((t) => (t.base ? [t.base.binding] : []))]);
      let message: string;
      if (possiblyHiddenAtBase.has(key)) {
        message =
          `\`${m.text}\` ${label} on ${target(site)} is now certainly the runner's; at base the test was hidden only by markers that may not have applied` +
          (possiblyHiddenAtBase.get(key) ? ` (${possiblyHiddenAtBase.get(key)})` : '');
      } else {
        const verb = existedAtBase(site.file, m) ? `Changes the condition of \`${m.text}\` ${label} on` : `Adds \`${m.text}\` ${label} to`;
        message =
          `${verb} ${target(site)}${note}` +
          (!doubt.certain
            ? `; it ${MAY[m.kind](names.length === 1 ? 'it' : 'them')}: ${doubt.why}`
            : site.why !== null
              ? `; it ${MAY[m.kind](names.length === 1 ? 'it' : 'them')}: ${site.why}`
              : '');
      }
      // A marker on tests that did not exist at base (no counterpart by name, rename or move) loses nothing: one
      // INFO line, never a warning. A test that replaced a removed one is TG001's (it warns on the substitution).
      // New means no counterpart and no test of that name in the file at base: with a repeated title, which test is
      // which is not certain (the matching pairs them by order), so it is not new.
      const baseNames = new Set(ctx.base.files.get(baseOf.get(site.file) ?? site.file)?.tests.map((t) => t.name) ?? []);
      if (site.tests.length > 0 && site.tests.every((t) => t.base === null && !baseNames.has(t.test.name))) {
        return {
          rule: 'TG003',
          severity: 'info',
          file: site.file,
          side: 'head',
          line: m.line,
          test: names.length === 1 ? names[0]! : null,
          message: `Adds \`${m.text}\` ${label} to ${target(site)}, which did not exist at base: no test that existed loses anything`,
          reason: NEW_TEST,
          tests: names,
        };
      }
      // Tampering, for the claim context: an unconditional marker that keeps tests
      // from being verified. Not platform/opaque conditions, not checked
      // expected failures, not a body-less `todo` (it hides nothing).
      const hides = m.condition === 'unconditional' && !m.checked && site.tests.some((t) => t.test.body !== '');
      return {
        ...(hides ? { tampering: true as const } : {}),
        rule: 'TG003',
        severity: site.severity,
        ...(site.severity === 'fail' && m.effect.known ? { effect: m.effect.effect } : {}),
        file: site.file,
        side: 'head',
        line: m.line,
        test: names.length === 1 ? names[0]! : null,
        message,
        tests: names,
        ...(site.severity === 'fail' ? { ids: site.failing.map((t): TestId => [t.test.name, t.test.ordinal]) } : {}),
      };
    });
    const covered = new Set(groups.all().map((s) => siteKey(s.file, s.marker)));
    // In a test file that did not exist at base every test is new: a marker there loses nothing (INFO).
    return [...findings, ...uncoveredSiteFindings('TG003', newMarkerSites(ctx, DISABLING), covered, true)];
  },
};

