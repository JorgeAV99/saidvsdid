// TG007: the agent says it added a regression test; what does the final diff
// show? A warning for the reviewer, never a verdict on the claim: at most a
// WARN, never a FAIL or a PASS, whatever the claim's certainty.
//
// Only the last turn's claim is compared with the final diff (an earlier
// turn's is an INFO "superseded by later turns"). Candidates are the tests the
// diff adds or modifies (new tests, tests substituted or split, paired tests
// whose body or parameter table changed).
// - WARN: no candidate ("final diff contains no test"); every candidate
//   disabled (TG003's markers) or asserting nothing (TG004's test), or
//   uncertain (a conditional skip, assertions only through helpers);
//   test-like files that cannot be parsed.
// - INFO: valid candidates, not run.
// - with --f2p: the valid candidates run on base (with the head test files
//   copied in) and on head. One fails on base and passes on head: INFO (a
//   fact, not a certificate). All pass on base: WARN. An error on base, or a
//   run that cannot run or conclude: WARN.
import { runF2p, f2pKey, type F2pStatus, type F2pTarget } from '../f2p.js';
import type { TestCase } from '../parse/index.js';
import type { TestRef } from './match.js';
import type { Claim } from '../evidence/schema.js';
import type { CheckContext, Finding, Rule } from './types.js';
import { disablingMarkers, listNames, quote } from './util.js';

type Verdict = { valid: true } | { valid: false; certain: boolean; why: string };

function assess(test: TestCase): Verdict {
  const disabling = disablingMarkers(test);
  // A marker not certainly the runner's (docs/rules.md, *Attribution*) may not disable it.
  const unconditional = disabling.find((m) => m.condition === 'unconditional' && m.binding.certain);
  if (unconditional) return { valid: false, certain: true, why: `is disabled by \`${unconditional.text}\`` };
  const first = disabling[0];
  if (first && !first.binding.certain) return { valid: false, certain: false, why: `may be disabled by \`${first.text}\` (${first.binding.why})` };
  if (first) return { valid: false, certain: false, why: `is disabled under a condition (\`${first.text}\`)` };
  if (test.assertions === 0) {
    return test.helperCalls.length
      ? { valid: false, certain: false, why: `asserts only through ${test.helperCalls.map((h) => `\`${h}\``).join(', ')}` }
      : { valid: false, certain: true, why: 'has no assertions and calls nothing that could assert' };
  }
  return { valid: true };
}

function candidates(ctx: CheckContext): TestRef[] {
  const out: TestRef[] = [...ctx.matching.added];
  for (const s of ctx.matching.substitutions) out.push(s.head);
  for (const s of ctx.matching.splits) out.push(...s.heads);
  // Modified: its body, or its parameter table (a row added to `it.each` / `parametrize`).
  for (const p of ctx.matching.pairs) if (p.base.test.body !== p.head.test.body || p.base.test.params !== p.head.test.params) out.push(p.head);
  return out;
}

/** Changed files that look like tests but were not analysed (another language, a helper directory). */
function unparsedTestLike(ctx: CheckContext): string[] {
  const analysed = new Set([...ctx.head.files.keys(), ...ctx.base.files.keys()]);
  return ctx.allChanges
    .map((c) => c.headPath ?? c.basePath!)
    .filter((p) => !analysed.has(p) && /(^|\/)(tests?|specs?|__tests__)\/|[._-](test|spec)s?\.|(^|\/)test_[^/]*$/i.test(p));
}

const STATUS_WORD: Record<F2pStatus, string> = { passed: 'passes', failed: 'fails', error: 'errors', skipped: 'is skipped', missing: 'was not run' };

export const TG007: Rule = {
  id: 'TG007',
  title: 'Regression test claimed: what the final diff shows',
  run(ctx) {
    const claims = ctx.evidence?.claims.filter((c) => c.kind === 'regression_test_added') ?? [];
    // Only the last turn's claims describe the final diff (a PR body too); an earlier turn's claim may
    // be about a state the agent later changed.
    const final = claims.find((c) => c.source !== 'turn_end');
    const earlier = claims.filter((c) => c.source === 'turn_end');
    const out = final ? judge(ctx, final) : [];
    if (earlier.length) {
      out.push({
        rule: 'TG007',
        severity: 'info',
        file: ctx.evidenceLabel,
        side: 'head',
        line: null,
        test: null,
        reason: 'superseded',
        message: `${earlier.length === 1 ? 'An earlier turn said' : `${earlier.length} earlier turns said`} ${earlier.map((c) => quoted(c.text)).join(', ')}; superseded by later turns: only the last turn's claims are compared with the final diff`,
      });
    }
    return out;
  },
};

const quoted = (text: string): string => `"${text.length > 100 ? `${text.slice(0, 99)}…` : text}"`;

/**
 * The last turn's claim against the final diff: at most a WARN, described as facts for the reviewer
 * (the claim's certainty does not change it: a claim is never certified from outside the runner).
 */
function judge(ctx: CheckContext, claim: Claim): Finding[] {
  const said = `The agent said ${quoted(claim.text)}`;
  const at = (file: string | null, test: TestRef | null): Pick<Finding, 'rule' | 'file' | 'side' | 'line' | 'test'> => ({
    rule: 'TG007',
    file: file ?? ctx.evidenceLabel,
    side: 'head',
    line: test?.test.line ?? null,
    test: test?.test.name ?? null,
  });
  const refs = candidates(ctx);
  const unparsed = unparsedTestLike(ctx);
  if (refs.length === 0) {
    if (unparsed.length) {
      return [{ ...at(null, null), severity: 'warn', reason: 'unanalysed_tests', message: `${said}; final diff contains no test saidvsdid can analyse: ${listNames(unparsed)} changed and could not be analysed` }];
    }
    return [{ ...at(null, null), severity: 'warn', reason: 'no_test_in_diff', message: `${said}; final diff contains no test` }];
  }
  const assessed = refs.map((r) => ({ ref: r, verdict: assess(r.test) }));
  const valid = assessed.filter((a) => a.verdict.valid).map((a) => a.ref);
  const single = refs.length === 1 ? refs[0]! : null;
  if (valid.length === 0) {
    const reasons = assessed.map((a) => `${quote(a.ref.test.name)} ${(a.verdict as { why: string }).why}`);
    return [{ ...at(single?.file ?? null, single), severity: 'warn', reason: 'no_valid_test', message: `${said}; in the final diff ${reasons.join('; ')}`, tests: refs.map((r) => r.test.name) }];
  }
  const names = valid.map((r) => r.test.name);
  const one = valid.length === 1 ? valid[0]! : null;
  if (!ctx.f2p) {
    return [{ ...at(one?.file ?? null, one), severity: 'info', reason: 'not_run', message: `${said}; ${listNames(names)} added or modified, not run (--f2p runs it on base and head)`, tests: names }];
  }
  // --f2p could not run or could not conclude: a warning, like everything about a claim.
  const inconclusive = (file: string | null, why: string, tests: string[]): Finding[] => [{ ...at(file, null), severity: 'warn', reason: 'f2p_inconclusive', message: `${said}; --f2p ${why}`, tests }];
  if (!ctx.repoDir) return inconclusive(null, 'needs a git repository on disk', names);
  const targets: F2pTarget[] = valid.map((r) => ({ file: r.file, name: r.test.name, table: r.test.params !== '' }));
  const result = runF2p(ctx.repoDir, ctx.base.sha, ctx.head.sha, targets, ctx.f2p.timeoutMs);
  if (!result.ok) return inconclusive(valid[0]!.file, `could not run the tests: ${result.reason}`, names);
  const outcome = targets.map((t) => ({ t, base: result.base.get(f2pKey(t)) ?? 'missing', head: result.head.get(f2pKey(t)) ?? 'missing' }));
  const f2p = outcome.filter((o) => o.base === 'failed' && o.head === 'passed');
  const describe = (o: (typeof outcome)[number]): string => `${quote(o.t.name)} ${STATUS_WORD[o.base]} on base and ${STATUS_WORD[o.head]} on head`;
  const ref = (o: (typeof outcome)[number] | undefined): TestRef | null => (o ? valid.find((r) => r.file === o.t.file && r.test.name === o.t.name) ?? null : null);
  if (f2p.length) {
    return [{ ...at(f2p[0]!.t.file, ref(f2p[0])), severity: 'info', reason: 'fails_on_base', message: `${said}; --f2p: ${f2p.map(describe).join('; ')}`, tests: f2p.map((o) => o.t.name) }];
  }
  const passOnBase = outcome.filter((o) => o.base === 'passed' && o.head === 'passed');
  if (passOnBase.length === outcome.length) {
    const single1 = outcome.length === 1 ? outcome[0] : undefined;
    return [{ ...at(single1?.t.file ?? null, ref(single1)), severity: 'warn', reason: 'passes_on_base', message: `${said}; --f2p: ${outcome.map(describe).join('; ')}`, tests: outcome.map((o) => o.t.name) }];
  }
  const errored = outcome.filter((o) => o.base === 'error' && o.head === 'passed');
  if (errored.length && errored.length + passOnBase.length === outcome.length) {
    return [{ ...at(errored[0]!.t.file, ref(errored[0])), severity: 'warn', reason: 'error_on_base', message: `${said}; --f2p: ${outcome.map(describe).join('; ')} (an error on base, not a test failure)`, tests: outcome.map((o) => o.t.name) }];
  }
  const rowless = outcome.filter((o) => o.t.table && o.base === 'missing' && o.head === 'missing');
  return inconclusive(
    outcome[0]!.t.file,
    rowless.length === outcome.length
      ? `could not tell the rows of ${rowless.map((o) => quote(o.t.name)).join(', ')} apart, or they differ between base and head (rows are compared by the ids the runner reports)`
      : `shows no fail-to-pass: ${outcome.map(describe).join('; ')}`,
    outcome.map((o) => o.t.name),
  );
}
