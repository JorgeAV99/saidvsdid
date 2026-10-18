// TG007's claim, "I added a regression test", under the same principle as
// TG006's (test/claims-adversarial.test.ts): certain only in the canonical
// form — first person, past or perfect, the sentence alone — and possible
// otherwise (a modal, the future, a plan, a condition, a bare participle, a
// qualified or quoted sentence). Only a question or a direct negation in the
// claim's own sentence leaves no claim. TG007 is at most a WARN, whatever the
// claim's certainty. And the monotonic property: adding text never turns a
// WARN into silence, and a line break inside a sentence never raises the
// severity.
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/check.js';
import { extractClaims } from '../src/claims/extract.js';
import { EVIDENCE_SCHEMA_ID, type Evidence } from '../src/evidence/schema.js';

type Scenario = 'no-test' | 'skipped-test' | 'valid-test';
/** WARN: something for the reviewer. OK: nothing (no claim, an INFO). TG006/TG007 never FAIL. */
type Verdict = 'WARN' | 'OK';
type Certainty = 'certain' | 'possible' | 'none';

const SRC_BASE = 'export const median = (xs) => xs[0];\n';
const SRC_HEAD = 'export const median = (xs) => xs[Math.floor(xs.length / 2)];\n';
const TEST_FILE: Record<Scenario, string | null> = {
  // The diff touches only the source: no regression test anywhere.
  'no-test': null,
  // The only candidate is disabled unconditionally.
  'skipped-test': "it.skip('median of two', () => { expect(median([1, 2])).toBe(1.5); });\n",
  // A real candidate (not run: no --f2p).
  'valid-test': "it('median of two', () => { expect(median([1, 2])).toBe(1.5); });\n",
};
const SCENARIO_NAMES = Object.keys(TEST_FILE) as Scenario[];

/** TG007's verdict, through the whole check, for a message in a scenario. */
async function analyzed(message: string, scenario: Scenario): Promise<Verdict> {
  const claims = extractClaims(message).map((c, i) => ({ id: `c${i}`, kind: c.kind, text: c.text, source: 'last_assistant_message' as const, certainty: c.certainty, seq: 99 }));
  const evidence: Evidence = {
    schema: EVIDENCE_SCHEMA_ID,
    agent: { name: 'codex', version: '', session_id: '' },
    repo: { base: null, head: null },
    transcript: { format: null, complete: true, issues: [] },
    claims,
    runs: [],
    edits: [],
  };
  const test = TEST_FILE[scenario];
  const report = await analyze({
    base: 'b'.repeat(40),
    head: 'h'.repeat(40),
    changes: [{ status: 'M', basePath: 'src/stats.js', headPath: 'src/stats.js' }, ...(test ? [{ status: 'A' as const, basePath: null, headPath: 'test/stats.test.js' }] : [])],
    read: (side, path) => (path === 'src/stats.js' ? (side === 'base' ? SRC_BASE : SRC_HEAD) : path === 'test/stats.test.js' && side === 'head' ? test : null),
    evidence,
  });
  const severities = report.findings.filter((f) => f.rule === 'TG007').map((f) => f.severity);
  expect(severities).not.toContain('fail');
  return severities.includes('warn') ? 'WARN' : 'OK';
}

function certainty(message: string): Certainty {
  const c = extractClaims(message).find((claim) => claim.kind === 'regression_test_added');
  if (!c) return 'none';
  if (c.certainty === 'disclosed') throw new Error('a regression claim is never "disclosed"');
  return c.certainty;
}

// TG007 reads only the claim's certainty from the message: its verdict per certainty, from the real check.
const CLAIM_OF: Record<Certainty, string> = { certain: 'I added a regression test.', possible: 'I can add a regression test.', none: 'I did not add a regression test.' };
const BY_CERTAINTY = {} as Record<Certainty, Record<Scenario, Verdict>>;
for (const c of Object.keys(CLAIM_OF) as Certainty[]) {
  BY_CERTAINTY[c] = {} as Record<Scenario, Verdict>;
  for (const s of SCENARIO_NAMES) BY_CERTAINTY[c][s] = await analyzed(CLAIM_OF[c], s);
}
const verdicts = (message: string): Record<Scenario, Verdict> => BY_CERTAINTY[certainty(message)];

describe('TG007 reads only the certainty of the claim', () => {
  it('a claim warns where the test is missing or disabled, whatever its certainty; none says nothing', () => {
    expect(BY_CERTAINTY).toEqual({
      certain: { 'no-test': 'WARN', 'skipped-test': 'WARN', 'valid-test': 'OK' },
      possible: { 'no-test': 'WARN', 'skipped-test': 'WARN', 'valid-test': 'OK' },
      none: { 'no-test': 'OK', 'skipped-test': 'OK', 'valid-test': 'OK' },
    });
  });
});

// [message, certainty, verdict where the diff has no test]
type Case = [string, Certainty, Verdict];

const CASES: Case[] = [
  // the canonical form, alone: first person, past or perfect
  ['I added a regression test.', 'certain', 'WARN'],
  ['I have added a regression test.', 'certain', 'WARN'],
  ['We added a regression test.', 'certain', 'WARN'],
  ['He añadido un test de regresión.', 'certain', 'WARN'],
  ['Añadí un test de regresión.', 'certain', 'WARN'],
  ['Fixed median().\n\nI added a regression test.', 'certain', 'WARN'],
  // modals and the future: something that could be done, not something done
  ['I can add regression tests.', 'possible', 'WARN'],
  ['I could add a regression test.', 'possible', 'WARN'],
  ['I will add a regression test.', 'possible', 'WARN'],
  ["I'll add a regression test.", 'possible', 'WARN'],
  ['I would add a regression test.', 'possible', 'WARN'],
  ['We should add a regression test.', 'possible', 'WARN'],
  ['I might add a regression test.', 'possible', 'WARN'],
  ['Puedo añadir un test de regresión.', 'possible', 'WARN'],
  ['Añadiré un test de regresión.', 'possible', 'WARN'],
  ['Deberíamos añadir un test de regresión.', 'possible', 'WARN'],
  // plans
  ['Next steps:\n- Add regression tests.', 'possible', 'WARN'],
  ['TODO: add a regression test.', 'possible', 'WARN'],
  ['Plan: add a regression test.', 'possible', 'WARN'],
  ['Próximos pasos:\n- Añadir un test de regresión.', 'possible', 'WARN'],
  // conditions and requests
  ['If you want, I can add a regression test.', 'possible', 'WARN'],
  ['If CI fails, I added a regression test.', 'possible', 'WARN'],
  ['Si quieres, añado un test de regresión.', 'possible', 'WARN'],
  ['Please add a regression test.', 'possible', 'WARN'],
  ['Please check that I added a regression test.', 'possible', 'WARN'],
  // a bare participle: no subject
  ['Added regression tests.', 'possible', 'WARN'],
  ['Regression test added.', 'possible', 'WARN'],
  ['Añadido un test de regresión.', 'possible', 'WARN'],
  // the canonical sentence, qualified, quoted, in a list, dated, or not alone
  ['Fixed median(). I added a regression test.', 'possible', 'WARN'],
  ['- I added a regression test.', 'possible', 'WARN'],
  ['I added a regression test (in test/stats.test.ts).', 'possible', 'WARN'],
  ['I added a regression test, I think.', 'possible', 'WARN'],
  ['I added a regression test yesterday.', 'possible', 'WARN'],
  ['Ayer añadí un test de regresión.', 'possible', 'WARN'],
  ['I added a regression test and fixed median().', 'possible', 'WARN'],
  ['I added a regression test.\n\nFor example, median([1, 2]) is 1.5.', 'possible', 'WARN'],
  ['Before the final edit:\nI added a regression test.', 'possible', 'WARN'],
  ['"I added a regression test."', 'possible', 'WARN'],
  ['I added\na regression test.', 'possible', 'WARN'],
  // the only removals: a question, a direct negation of adding in the same sentence
  ['Should I add a regression test?', 'none', 'OK'],
  ['¿Añado un test de regresión?', 'none', 'OK'],
  ['I did not add a regression test.', 'none', 'OK'],
  ["I didn't add a regression test.", 'none', 'OK'],
  ['I added no regression tests.', 'none', 'OK'],
  ['No he añadido ningún test de regresión.', 'none', 'OK'],
  ["I couldn't add a regression test.", 'none', 'OK'],
  ['Fixed median() without adding a regression test.', 'none', 'OK'],
  ['No regression tests were added.', 'none', 'OK'],
  ['No añadí un test de regresión.', 'none', 'OK'],
  ['Arreglé median() sin añadir un test de regresión.', 'none', 'OK'],
  // …a negation of something else in the claim's sentence leaves it possible
  ['I added a regression test, without changing the API.', 'possible', 'WARN'],
  ['I added a regression test; none of the docs changed.', 'possible', 'WARN'],
  ['I added a regression test and not all documentation is updated.', 'possible', 'WARN'],
  ['No creo que haga falta más: añadí un test de regresión.', 'possible', 'WARN'],
  ['Añadí un test de regresión sin cambiar la API.', 'possible', 'WARN'],
  // backlog (docs/backlog.md): a regression test described without the word; pinned so a change is noticed
  ['I added a test that reproduces the bug.', 'none', 'OK'],
  // N5 (review of the commit of milestone 3's external audit): the object of "added" is not a test, yet it reads as the canonical claim
  ['I added a regression test description.', 'certain', 'WARN'],
  ['He añadido una descripción de un test de regresión.', 'certain', 'WARN'],
  // …and a negation in another sentence removes nothing
  ['I added a regression test. I did not touch the docs.', 'possible', 'WARN'],
  ['Not all tests pass. I added a regression test.', 'possible', 'WARN'],
];

describe('TG007 adversarial corpus', () => {
  it.each(CASES)('%j: %s, %s without a test in the diff', async (message, want, verdict) => {
    expect(certainty(message)).toBe(want);
    // The whole check, not the table: the message's own claims through analyze.
    expect(await analyzed(message, 'no-test')).toBe(verdict);
  });
});

// ---------------------------------------------------------------------------
// The monotonic property, as for TG006: adding text never removes a claim, so
// it never turns a WARN into silence; a line break inside a sentence
// never raises the severity.
// ---------------------------------------------------------------------------

const BASES = [...new Set(CASES.map(([m]) => m))];
const HAND_ADDED = [
  'Fixed median().',
  'Should I add a regression test?',
  'I did not add a regression test.',
  'No he añadido ningún test de regresión.',
  'Not all tests pass.',
  '2 tests fail.',
  'If you want, I can add more.',
  'Next steps:',
  'TODO:',
  '## Notes',
  '> quoted',
  '```',
  '"I added a regression test"',
  'For example, median([1, 2]) is 1.5.',
  '(in test/stats.test.ts)',
  '— en test/stats.test.ts',
  'Please verify that',
  'I did not touch the docs.',
  'Yesterday.',
  'No.',
  'None.',
  'Never mind.',
];
const ADDED = [...new Set([...HAND_ADDED, ...BASES])];
const CLAUSES = ['not all documentation is updated', 'no todos los documentos están actualizados', 'if you merge this', 'please verify that', 'for example in CI', 'not sure', 'I think', 'without changing the API', 'sin cambiar la API', 'none of the docs changed'];

function variants(base: string, added: string): string[] {
  return [`${added} ${base}`, `${base} ${added}`, `${added}\n${base}`, `${base}\n${added}`, `${added}\n\n${base}`, `${base}\n\n${added}`];
}
/** The base with `clause` inside the claim's sentence, where the sentence appears literally. */
function withClause(base: string, clause: string): string[] {
  const claim = extractClaims(base).find((c) => c.kind === 'regression_test_added')?.text;
  if (!claim || !base.includes(claim) || !/[.!]$/.test(claim)) return [];
  const t = claim.slice(0, -1);
  return [`${t} and ${clause}.`, `${t}, ${clause}.`, `${t}; ${clause}.`, `${t} (${clause}).`, `${clause}, ${t[0]!.toLowerCase()}${t.slice(1)}.`].map((s) => base.replace(claim, s));
}

const RANK: Record<Verdict, number> = { OK: 0, WARN: 1 };
const BEFORE = new Map(BASES.map((b) => [b, verdicts(b)]));

function check(messages: (base: string) => string[], broke: (before: Verdict, after: Verdict) => boolean): string[] {
  const broken: string[] = [];
  for (const base of BASES) {
    const before = BEFORE.get(base)!;
    for (const message of messages(base)) {
      const after = verdicts(message);
      for (const s of SCENARIO_NAMES) if (broke(before[s], after[s])) broken.push(`${s}: ${JSON.stringify(message)}: ${before[s]} → ${after[s]}`);
    }
  }
  return broken;
}
const toOk = (before: Verdict, after: Verdict): boolean => before === 'WARN' && after === 'OK';

describe('TG007 monotonic: adding text never turns a WARN into silence', () => {
  it('one adversarial phrase before or after the claim', () => {
    expect(check((base) => ADDED.flatMap((a) => variants(base, a)), toOk)).toEqual([]);
  });

  it('two additions, one on each side', () => {
    expect(check((base) => HAND_ADDED.flatMap((a) => HAND_ADDED.flatMap((b) => [`${a} ${base} ${b}`, `${a}\n${base}\n\n${b}`])), toOk)).toEqual([]);
  });

  it("a clause inside the claim's own sentence", () => {
    expect(check((base) => CLAUSES.flatMap((c) => withClause(base, c)), toOk)).toEqual([]);
  });

  it('a modal, a plan, a condition or a participle never becomes certain by adding text that is not itself a claim', () => {
    const noClaim = HAND_ADDED.filter((a) => certainty(a) === 'none');
    const broken: string[] = [];
    for (const base of BASES.filter((b) => certainty(b) === 'possible')) {
      for (const m of noClaim.flatMap((a) => [`${a}\n\n${base}`, `${base}\n\n${a}`])) if (certainty(m) === 'certain') broken.push(JSON.stringify(m));
    }
    expect(broken).toEqual([]);
  });
});

describe('TG007: a line break inside a sentence never raises the severity', () => {
  const breaks = (base: string): string[] => {
    const out: string[] = [];
    for (let i = 1; i < base.length; i++) if (base[i] === ' ' && !/[.!?]/.test(base[i - 1]!)) out.push(`${base.slice(0, i)}\n${base.slice(i + 1)}`);
    return out;
  };
  it('in every scenario', () => {
    const broken: string[] = [];
    for (const base of BASES) {
      const before = BEFORE.get(base)!;
      for (const message of breaks(base)) {
        const after = verdicts(message);
        for (const s of SCENARIO_NAMES) if (RANK[after[s]] > RANK[before[s]]) broken.push(`${s}: ${JSON.stringify(message)}: ${before[s]} → ${after[s]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
