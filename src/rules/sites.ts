import type { Marker, TestCase } from '../parse/index.js';
import type { CheckContext, Severity } from './types.js';
import { sameName } from './ids.js';
import { maxSeverity } from './util.js';

export interface HeadTest {
  file: string;
  test: TestCase;
  /** The same test at base, when it existed there (exact match, rename or move). */
  base: TestCase | null;
  /** How many tests of the base test's file have its name (≥ 2: its identity at base is not certain). */
  baseSameName: number;
}

export function headTests(ctx: CheckContext): HeadTest[] {
  const counterpart = new Map<TestCase, { test: TestCase; file: string }>();
  for (const p of ctx.matching.pairs) counterpart.set(p.head.test, { test: p.base.test, file: p.base.file });
  const out: HeadTest[] = [];
  for (const [file, tf] of ctx.head.files) {
    for (const test of tf.tests) {
      const base = counterpart.get(test) ?? null;
      out.push({ file, test, base: base?.test ?? null, baseSameName: base ? sameName(ctx.base.files.get(base.file)?.tests ?? [], base.test.name) : 0 });
    }
  }
  return out;
}

/** Findings are reported once per marker site (e.g. one `describe.skip`), not once per test. */
export interface Site {
  file: string;
  marker: Marker;
  severity: Severity;
  tests: HeadTest[];
  /** The tests the marker gives a FAIL for (the site's FAIL is about their status alone). */
  failing: HeadTest[];
  /** Why a marker the runner certainly applies is not a FAIL (a form that is not canonical, a second effect…), the first given. */
  why: string | null;
}

export const siteKey = (file: string, marker: Marker): string => `${file}\0${marker.site}`;

export class SiteGroups {
  private readonly sites = new Map<string, Site>();

  add(file: string, marker: Marker, severity: Severity, test: HeadTest, why: string | null = null): void {
    const key = siteKey(file, marker);
    const site = this.sites.get(key);
    if (site) {
      site.severity = maxSeverity(site.severity, severity);
      site.tests.push(test);
      if (severity === 'fail') site.failing.push(test);
      site.why ??= why;
    } else {
      this.sites.set(key, { file, marker, severity, tests: [test], failing: severity === 'fail' ? [test] : [], why });
    }
  }

  all(): Site[] {
    return [...this.sites.values()];
  }
}
