// The marker census backs the invariant: if the diff adds a skip/focus marker
// anywhere in a test file, the verdict is never OK (exit 0).
//
// Rules attribute markers they are certain about and report them with their own
// severity. Every other new marker site — in a helper, a callback, a method, a
// hook passed by reference, or one that has no effect (`skipIf(false)`, a test
// that was already skipped) — becomes a WARN here.
import type { MarkerKind, MarkerSite } from '../parse/index.js';
import type { CheckContext, Finding, RuleId } from './types.js';
import { NEW_TEST } from './util.js';

export interface NewSite {
  file: string;
  site: MarkerSite;
  /** The file did not exist at base (no file and no rename at that path): every test in it is new. */
  newFile: boolean;
}

const lastSegment = (site: string): string => site.slice(site.lastIndexOf('/') + 1);

/**
 * Head sites of test-level markers carried over by a renamed or moved test
 * (paired by TG001): the same marker kind and form on the test's counterpart
 * at base. Renaming `it.only('a')` to `it.only('b')` adds no marker.
 */
function carriedSites(ctx: CheckContext): Set<string> {
  const carried = new Set<string>();
  for (const p of ctx.matching.pairs) {
    if (!p.nameChanged && !p.fileChanged) continue;
    const before = p.base.test.markers.filter((m) => m.scope === 'test').map((m) => `${m.kind}\0${lastSegment(m.site)}`);
    for (const m of p.head.test.markers) {
      const at = before.indexOf(`${m.kind}\0${lastSegment(m.site)}`);
      if (m.scope !== 'test' || at === -1) continue;
      before.splice(at, 1);
      carried.add(`${p.head.file}\0${m.site}`);
    }
  }
  return carried;
}

/** Marker sites at head whose structural id does not exist in the same file at base. */
export function newMarkerSites(ctx: CheckContext, kinds: ReadonlySet<MarkerKind>): NewSite[] {
  const baseOf = new Map<string, string>();
  for (const [basePath, headPath] of ctx.renames) baseOf.set(headPath, basePath);
  const carried = carriedSites(ctx);
  const out: NewSite[] = [];
  for (const [path, file] of ctx.head.files) {
    const base = ctx.base.files.get(baseOf.get(path) ?? path);
    const known = new Set(base?.markerSites.map((s) => s.site) ?? []);
    for (const site of file.markerSites) {
      if (kinds.has(site.kind) && !known.has(site.site) && !carried.has(`${path}\0${site.site}`)) out.push({ file: path, site, newFile: ctx.allChanges.some((c) => c.headPath === path && c.basePath === null) });
    }
  }
  return out;
}

const KIND_WORD: Record<MarkerKind, string> = { only: 'focus', skip: 'skip', todo: 'todo', fixme: 'fixme', xfail: 'expected-failure' };

/**
 * WARN findings for new sites that no attributed finding (warn or fail) already covers. `newFileInfo`: a site in a
 * file that did not exist at base is an INFO line (NEW_TEST; TG003's disabling markers only: every test there is new).
 */
export function uncoveredSiteFindings(rule: RuleId, sites: NewSite[], covered: ReadonlySet<string>, newFileInfo = false): Finding[] {
  return sites
    .filter((s) => !covered.has(`${s.file}\0${s.site.site}`))
    .map(({ file, site, newFile }): Finding => newFileInfo && newFile ? {
      rule,
      severity: 'info',
      file,
      side: 'head',
      line: site.line,
      test: null,
      message: `Adds the ${KIND_WORD[site.kind]} marker \`${site.text}\` at ${file}:${site.line}, in a test file that did not exist at base: no test that existed loses anything`,
      reason: NEW_TEST,
    } : {
      rule,
      severity: 'warn' as const,
      file,
      side: 'head' as const,
      line: site.line,
      test: null,
      message: site.attributed
        ? `Adds the ${KIND_WORD[site.kind]} marker \`${site.text}\` at ${file}:${site.line} on no test it newly marks at that level ` +
          `(a constant condition, a marker already there, or nothing in scope); review it`
        : `Adds the ${KIND_WORD[site.kind]} marker \`${site.text}\` at ${file}:${site.line}, which may apply to tests; ` +
          `it could not be attributed to a specific test (a helper, a callback, a hook passed by reference)`,
    });
}
