// TG001: a test, or a whole test file, disappeared between base and head.
//
// Messages describe the code, and the file's state in head's git tree (renames
// as git detects them): "deletes the test file, which declared N tests" when
// the file is gone; "removes all N test declarations from <file> (file kept)"
// when it is still there, under its name or another; "removes test …".
import type { TestCase } from '../parse/index.js';
import type { TestId } from './ids.js';
import type { TestRef } from './match.js';
import type { Finding, Rule, Severity } from './types.js';
import { disablingMarkers, hiddenLevel, listNames, maxSeverity, pct, quote, weakestOf } from './util.js';
import { localCodeChanged, type ImportCache } from './withcode.js';

/**
 * FAIL is reserved for deleting a whole test file with a test that ran,
 * declared certainly through the runner's API (docs/rules.md, *Attribution*):
 * a test declared through a global, a local wrapper or a helper's export may
 * not be a test, so its file's deletion warns. A single test that disappears
 * from a surviving file, or is replaced by an unrelated one, may have been
 * merged or rewritten under a new name: the diff alone cannot tell, so it
 * warns. An empty `todo` is informational.
 */
function severityFor(test: TestCase, wholeFile: boolean): Severity {
  if (test.body === '' && disablingMarkers(test).some((m) => m.kind === 'todo')) return 'info';
  // Deleting a file of unconditionally hidden tests (skip, todo, non-strict
  // xfail) removes nothing that ran. A strict expected failure still ran.
  return wholeFile && hiddenLevel(test) < 3 && test.binding.certain && test.declaration.canonical ? 'fail' : 'warn';
}

/** A test that ran and is the runner's, but whose declaration is not canonical (F7, F3): why the deletion is not a FAIL. */
function declarationDoubt(refs: readonly TestRef[]): string | null {
  const r = refs.find((x) => hiddenLevel(x.test) < 3 && x.test.binding.certain && !x.test.declaration.canonical);
  return r && !r.test.declaration.canonical ? `${quote(r.test.name)} may not have been collected as written: ${r.test.declaration.why}` : null;
}

export const TG001: Rule = {
  id: 'TG001',
  title: 'Test or test file removed',
  run(ctx) {
    const findings: Finding[] = [];

    const removedByFile = new Map<string, TestRef[]>();
    for (const r of ctx.matching.removed) removedByFile.set(r.file, [...(removedByFile.get(r.file) ?? []), r]);

    // Context for the reviewer, never a verdict (src/rules/withcode.ts): the local code a removed test used changed or
    // is gone in this PR. It may survive under another name or path, so the finding keeps its severity.
    const imports: ImportCache = new Map();
    const codeChanged = new Set(ctx.matching.removed.filter((r) => localCodeChanged(ctx, r.file, r.test, imports)));
    /** `; the local code … also changed or is gone in this PR`, for the removed tests among `refs` whose local code did. */
    const codeContext = (refs: readonly TestRef[], single: boolean): string => {
      const n = refs.filter((r) => codeChanged.has(r)).length;
      if (n === 0) return '';
      const who = single ? 'this test' : n === refs.length ? (n === 1 ? 'it' : 'they') : `${n} of them`;
      return `; the local code ${who} used also changed or is gone in this PR`;
    };

    for (const [file, refs] of removedByFile) {
      const baseFile = ctx.base.files.get(file);
      // Where the file is in head's tree: git's change for it (deleted, renamed, modified); unchanged: kept.
      const change = ctx.allChanges.find((c) => c.basePath === file);
      const kept = change ? change.headPath : file;

      if (baseFile && refs.length === baseFile.tests.length && kept !== null) {
        // Every test declaration is gone but the file is still in head's tree: the diff alone cannot
        // tell where its tests went, so it warns.
        const names = refs.map((r) => r.test.name);
        const severity = refs.map((r) => severityFor(r.test, false)).reduce(maxSeverity);
        const doubt = weakestOf(refs.map((r) => r.test.binding));
        findings.push({
          rule: 'TG001',
          severity,
          file,
          side: 'base',
          line: null,
          test: null,
          message:
            `Removes all ${refs.length} test declaration${refs.length === 1 ? '' : 's'} from ${file} (file kept${kept !== file ? `, renamed to ${kept}` : ''}): ${listNames(names)}` +
            (doubt.certain ? '' : `; ${refs.length === 1 ? 'it may not have been the runner\'s test' : 'they may not have been the runner\'s tests'}: ${doubt.why}`) +
            codeContext(refs, false),
          tests: names,
          ...(refs.some((r) => severityFor(r.test, false) !== 'info' && hiddenLevel(r.test) < 3) ? { tampering: true as const } : {}),
        });
        continue;
      }

      if (baseFile && refs.length === baseFile.tests.length) {
        const names = refs.map((r) => r.test.name);
        const severity = refs.map((r) => severityFor(r.test, true)).reduce(maxSeverity);
        const doubt = weakestOf(refs.map((r) => r.test.binding));
        findings.push({
          rule: 'TG001',
          severity,
          file,
          side: 'base',
          line: null,
          test: null,
          message:
            `Deletes the test file, which declared ${refs.length} test${refs.length === 1 ? '' : 's'}: ${listNames(names)}` +
            (severity !== 'fail' && !doubt.certain ? `; ${refs.length === 1 ? 'it may not have been the runner\'s test' : 'they may not have been the runner\'s tests'}: ${doubt.why}` : '') +
            (severity !== 'fail' && doubt.certain && declarationDoubt(refs) ? `; ${declarationDoubt(refs)}` : '') +
            codeContext(refs, false),
          tests: names,
          ...(severity === 'fail' ? { ids: refs.filter((r) => severityFor(r.test, true) === 'fail').map((r): TestId => [r.test.name, r.test.ordinal]) } : {}),
          // Only when a test that ran is gone (the same condition as the FAIL).
          ...(refs.some((r) => severityFor(r.test, true) === 'fail') ? { tampering: true as const } : {}),
        });
        continue;
      }
      for (const r of refs) {
        const severity = severityFor(r.test, false);
        findings.push({
          rule: 'TG001',
          severity,
          file,
          side: 'base',
          line: r.test.line,
          test: r.test.name,
          message: `Removes test ${quote(r.test.name)}` + (r.test.binding.certain ? '' : ` (it may not have been the runner's test: ${r.test.binding.why})`) + codeContext([r], true),
          // Deleted, not renamed, moved, split or substituted (the matcher found no
          // counterpart), and it ran: deleting an already-skipped test hides nothing.
          ...(severity !== 'info' && hiddenLevel(r.test) < 3 ? { tampering: true as const } : {}),
        });
      }
    }

    for (const s of ctx.matching.substitutions) {
      findings.push({
        rule: 'TG001',
        severity: severityFor(s.base.test, false),
        file: s.head.file,
        side: 'head',
        line: s.head.test.line,
        test: s.base.test.name,
        message:
          `Removes test ${quote(s.base.test.name)} and adds ${quote(s.head.test.name)} in its place ` +
          `(body similarity ${pct(s.similarity)}, assertion calls ${s.base.test.assertions} → ${s.head.test.assertions})`,
      });
    }

    for (const s of ctx.matching.splits) {
      const first = s.heads[0]!;
      findings.push({
        rule: 'TG001',
        severity: 'info',
        file: first.file,
        side: 'head',
        line: first.test.line,
        test: s.base.test.name,
        message: `Test ${quote(s.base.test.name)} was split into ${listNames(s.heads.map((h) => h.test.name))}; all ${s.base.test.assertions} of its assertions were kept`,
        tests: s.heads.map((h) => h.test.name),
      });
    }

    for (const p of ctx.matching.pairs) {
      if (!p.nameChanged && !p.fileChanged) continue;
      const what = p.nameChanged && p.fileChanged
        ? `renamed to ${quote(p.head.test.name)} and moved to ${p.head.file}`
        : p.nameChanged
          ? `renamed to ${quote(p.head.test.name)}`
          : `moved to ${p.head.file}`;
      findings.push({
        rule: 'TG001',
        severity: 'info',
        file: p.head.file,
        side: 'head',
        line: p.head.test.line,
        test: p.base.test.name,
        message: `Test ${quote(p.base.test.name)} was ${what} (body similarity ${pct(p.similarity)})`,
      });
    }

    return findings;
  },
};
