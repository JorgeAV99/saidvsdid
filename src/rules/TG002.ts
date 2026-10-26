// TG002: a new focus marker (`.only`, `fit`, `fdescribe`, `@pytest.mark.only`)
// silently shrinks the suite to the focused tests.
//
// A marker is new when its structural site (the chain of enclosing
// describes/tests by name, see Marker.site) does not exist in the file at base.
// This catches a new `it.only` inside an existing `describe.only`, and keeps
// two `describe.only` written on the same line apart.
//
// FAIL only with certainty (docs/rules.md, *Attribution*, *Verdicts*): the new
// focus marker, every focus marker of the file at base and at head, and the
// tests left out are certainly the runner's, each focus marker is in a canonical
// form with no modifier on a describe around it. Otherwise the rule itself warns that
// the marker "may focus" and why. Messages describe the code: "adds `it.only`
// to test …; the file's focus now leaves out N tests it did not leave out at
// base".
import type { Binding, LanguageId, Marker, MarkerKind, TestCase, TestFile } from '../parse/index.js';
import { CERTAIN, uncertain } from '../parse/types.js';
import { newMarkerSites, uncoveredSiteFindings } from './census.js';
import type { TestId } from './ids.js';
import { SiteGroups, headTests, siteKey, type HeadTest } from './sites.js';
import type { CheckContext, Finding, Rule } from './types.js';
import { disablingMarkers, focusMarkers, listNames, weakestOf } from './util.js';

const FOCUS: ReadonlySet<MarkerKind> = new Set(['only']);

/**
 * Tests that run when the file's focus markers are honoured.
 * - JS/TS (vitest, mocha, Playwright): a nested `.only` narrows its focused
 *   ancestor, so a test runs only if no other `.only` sits deeper inside its
 *   innermost focused scope. (Jest keeps every test under a `describe.only`;
 *   the narrowing model is the stricter one and is what we report.)
 * - Python (pytest-only style plugins): any test carrying the mark runs.
 */
export function runningTests(tests: TestCase[], language: LanguageId): Set<TestCase> {
  const chains = tests.map((t) => focusMarkers(t).map((m) => m.site));
  if (chains.every((c) => c.length === 0)) return new Set(tests);
  const running = new Set<TestCase>();
  tests.forEach((t, i) => {
    const chain = chains[i]!;
    if (chain.length === 0) return;
    if (language === 'python') {
      running.add(t);
      return;
    }
    const innermost = chain[chain.length - 1]!;
    const narrowed = chains.some((c) => {
      const at = c.indexOf(innermost);
      return at !== -1 && c.length > at + 1;
    });
    if (!narrowed) running.add(t);
  });
  return running;
}

export function runningAtBase(ctx: CheckContext): Set<TestCase> {
  const running = new Set<TestCase>();
  for (const file of ctx.base.files.values()) {
    for (const t of runningTests(file.tests, file.language)) running.add(t);
  }
  return running;
}

/**
 * How certainly a focus marker of a test focuses as written (docs/rules.md, *Verdicts*): it is the runner's, in a
 * canonical form, and no describe around the focused declaration carries a modifier of its own (`describe.skip`,
 * `describe.only`, `describe.todo`…), whose interplay with the focus is the runner's (Jest keeps a `test.only` inside a
 * `describe.skip` skipped; Vitest focuses it away).
 */
function focusDoubt(test: TestCase, m: Marker): Binding {
  if (!m.binding.certain) return m.binding;
  if (!m.form.canonical) return uncertain(m.form.why);
  const around = test.markers.find((o) => o !== m && o.site !== m.site && o.scope !== 'test');
  return around ? uncertain(`\`${around.text}\` is on a describe around it, and the runner decides how the two combine`) : CERTAIN;
}

/** Whether every focus marker of a file certainly focuses as written (what is left out depends on all of them). */
function focusBinding(file: TestFile | undefined): Binding {
  return weakestOf((file?.tests ?? []).flatMap((t) => focusMarkers(t).map((m) => focusDoubt(t, m))));
}

export const TG002: Rule = {
  id: 'TG002',
  title: 'New focused test (.only / fit)',
  run(ctx) {
    const all = headTests(ctx);
    const fresh = newMarkerSites(ctx, FOCUS);
    const freshIds = new Set(fresh.map((s) => `${s.file}\0${s.site.site}`));

    const groups = new SiteGroups();
    for (const ht of all) {
      for (const m of focusMarkers(ht.test)) {
        if (freshIds.has(siteKey(ht.file, m))) groups.add(ht.file, m, 'warn', ht);
      }
    }

    // Tests outside the focus at head that were not at base, per head file; and whether that is
    // certain: every focus marker of the file at base and at head, and the tests, are the runner's.
    // F8 (docs/rules.md, *Verdicts*): the losses a FAIL is about are only tests of the file declared in a canonical form
    // (F3) at base and at head that ran at base — not skipped, todo or fixme by any marker, not out of the focus.
    const baseRunning = runningAtBase(ctx);
    const baseOf = new Map<string, string>();
    for (const [basePath, headPath] of ctx.renames) baseOf.set(headPath, basePath);
    const excluded = new Map<string, number>();
    const losses = new Map<string, HeadTest[]>();
    const doubt = new Map<string, Binding>();
    for (const [path, file] of ctx.head.files) {
      const running = runningTests(file.tests, file.language);
      const left = all.filter((ht) => ht.file === path && ht.base && baseRunning.has(ht.base) && !running.has(ht.test));
      if (left.length === 0) continue;
      excluded.set(path, left.length);
      losses.set(path, left.filter((ht) => ht.test.declaration.canonical && ht.base!.declaration.canonical && !disablingMarkers(ht.base!).some((m) => m.kind !== 'xfail')));
      doubt.set(path, weakestOf([focusBinding(file), focusBinding(ctx.base.files.get(baseOf.get(path) ?? path)), ...left.flatMap((ht) => [ht.test.binding, ht.base!.binding])]));
    }

    const findings: Finding[] = [];
    const reported = new Set<string>();
    for (const site of groups.all().sort((a, b) => a.marker.line - b.marker.line)) {
      const names = site.tests.map((t) => t.test.name);
      const uncertain = weakestOf([...site.tests.map((t) => focusDoubt(t.test, site.marker)), ...site.tests.map((t) => t.test.binding), doubt.get(site.file) ?? { certain: true }]);
      const lost = reported.has(site.file) ? [] : (losses.get(site.file) ?? []);
      const others = reported.has(site.file) ? 0 : (excluded.get(site.file) ?? 0);
      reported.add(site.file);
      // FAIL only when the file's focus certainly leaves out a test that ran at base (F8). What the focus leaves out is
      // said only when it is certain; tests it leaves out that did not certainly run at base are not named.
      const fails = lost.length > 0 && uncertain.certain;
      const effect = !uncertain.certain
        ? ''
        : lost.length > 0
          ? `; the file's focus now leaves out ${lost.length} test${lost.length === 1 ? '' : 's'} that ran at base: ${listNames(lost.map((t) => t.test.name))}`
          : others > 0
            ? `; the tests it now leaves out (${others}) did not certainly run at base as declared in a canonical form`
            : '; it leaves out no test that the file\'s focus did not already leave out at base';
      const what = site.marker.scope === 'test' ? `test${names.length === 1 ? '' : 's'}` : `a ${site.marker.scope} that declares ${names.length} test${names.length === 1 ? '' : 's'}:`;
      findings.push({
        rule: 'TG002',
        severity: fails ? 'fail' : 'warn',
        file: site.file,
        side: 'head',
        line: site.marker.line,
        test: names.length === 1 ? names[0]! : null,
        message: `Adds \`${site.marker.text}\` (focus, ${site.marker.scope}) to ${what} ${listNames(names)}${effect}` + (uncertain.certain ? '' : `; it may focus ${names.length === 1 ? 'it' : 'them'}: ${uncertain.why}`),
        tests: names,
        ...(fails ? { ids: lost.map((t): TestId => [t.test.name, t.test.ordinal]) } : {}),
      });
    }
    // Focus changes that leave tests out without a new marker (e.g. a test
    // moved out of a `describe.only`).
    for (const [file, count] of excluded) {
      if (reported.has(file)) continue;
      const uncertain = doubt.get(file) ?? { certain: true };
      const lost = losses.get(file) ?? [];
      const fails = lost.length > 0 && uncertain.certain;
      findings.push({
        rule: 'TG002',
        severity: fails ? 'fail' : 'warn',
        file,
        side: 'head',
        line: null,
        test: fails && lost.length === 1 ? lost[0]!.test.name : null,
        message: fails
          ? `The file's focus markers now leave out ${lost.length} test${lost.length === 1 ? '' : 's'} that ran at base: ${listNames(lost.map((t) => t.test.name))}`
          : `The file's focus markers changed around ${count} test${count === 1 ? '' : 's'}; this may change what runs${uncertain.certain ? ': the tests they now leave out did not certainly run at base as declared in a canonical form' : `: ${uncertain.why}`}`,
        ...(fails ? { tests: lost.map((t) => t.test.name), ids: lost.map((t): TestId => [t.test.name, t.test.ordinal]) } : {}),
      });
    }
    const covered = new Set(groups.all().map((s) => siteKey(s.file, s.marker)));
    return [...findings, ...uncoveredSiteFindings('TG002', fresh, covered)];
  },
};
