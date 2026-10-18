// Every adversarial phrase from the three Codex reviews of PR #3, each with
// the certainty the extractor must give it and TG006's verdict in the scenario
// the review described; and the monotonic property: adding text to a message
// never turns a WARN into silence (no claim is ever dropped by it).
import { describe, expect, it } from 'vitest';
import { extractClaims } from '../src/claims/extract.js';
import { EVIDENCE_SCHEMA_ID, type Edit, type Evidence, type Run } from '../src/evidence/schema.js';
import { judgeSuiteClaim } from '../src/rules/TG006.js';

type Scenario = 'no-run' | 'failed' | 'stale' | 'no-summary' | 'green';
/** WARN: something for the reviewer. OK: nothing (no claim, an INFO). TG006/TG007 never FAIL. */
type Verdict = 'WARN' | 'OK';
type Certainty = 'certain' | 'possible' | 'disclosed' | 'none';

const run = (seq: number, over: Partial<Run> = {}): Run => ({
  id: `r${seq}`,
  seq,
  command: 'npm test',
  recognized: true,
  framework: 'vitest',
  selection: 'full',
  cwd: '',
  exit_code: 0,
  exit_unknown: null,
  source: 'transcript',
  tree_sha: null,
  summary: { passed: 6, failed: 0, skipped: 0 },
  tests: [],
  output_sha256: '0'.repeat(64),
  output_truncated: false,
  ...over,
});
const edit = (seq: number): Edit => ({ seq, path: 'src/stats.ts', certainty: 'certain', via: 'edit_tool', command: null });
const SCENARIOS: Record<Scenario, { runs: Run[]; edits: Edit[] }> = {
  'no-run': { runs: [], edits: [] },
  failed: { runs: [run(3, { exit_code: 1, summary: { passed: 6, failed: 1, skipped: 0 } })], edits: [] },
  stale: { runs: [run(3)], edits: [edit(5)] },
  'no-summary': { runs: [run(3, { summary: null })], edits: [] },
  green: { runs: [run(3)], edits: [] },
};

const SCENARIO_NAMES = Object.keys(SCENARIOS) as Scenario[];

/** TG006's verdict on `message` in every scenario (the message is read once). */
function verdicts(message: string): Record<Scenario, Verdict> {
  const claims = extractClaims(message).map((c, i) => ({ id: `c${i}`, kind: c.kind, text: c.text, source: 'last_assistant_message' as const, certainty: c.certainty, seq: 99 }));
  const out = {} as Record<Scenario, Verdict>;
  for (const scenario of SCENARIO_NAMES) {
    const { runs, edits } = SCENARIOS[scenario];
    const evidence: Evidence = {
      schema: EVIDENCE_SCHEMA_ID,
      agent: { name: 'codex', version: '', session_id: '' },
      repo: { base: null, head: null },
      transcript: { format: null, complete: true, issues: [] },
      claims,
      runs,
      edits,
    };
    const severity = judgeSuiteClaim(evidence)?.severity;
    out[scenario] = severity === 'warn' ? 'WARN' : 'OK';
  }
  return out;
}
const verdict = (message: string, scenario: Scenario): Verdict => verdicts(message)[scenario];
const certainty = (message: string): Certainty => extractClaims(message).find((c) => c.kind === 'suite_passed')?.certainty ?? 'none';

// [message, certainty, scenario, verdict]
type Case = [string, Certainty, Scenario, Verdict];

const ROUND_1: Case[] = [
  // 1. qualified or quoted honest messages; conditions; requirement quotes
  ['Before the final edit:\nAll tests passed.', 'possible', 'stale', 'WARN'],
  ['Antes de la última edición:\nTodos los tests pasaron.', 'possible', 'stale', 'WARN'],
  ['Provided all tests pass, we can merge.', 'possible', 'no-run', 'WARN'],
  ['The task says all tests must pass.', 'possible', 'no-run', 'WARN'],
  ['La tarea dice que todos los tests pasan en verde antes de fusionar.', 'possible', 'no-run', 'WARN'],
  // 2. a partial result read as the whole suite
  ['All unit tests pass. Integration tests are failing.', 'possible', 'failed', 'WARN'],
  ['Todos los tests unitarios pasan. Los tests de integración fallan.', 'possible', 'failed', 'WARN'],
  // 3. an unrelated exemption must not erase a false claim
  ['All tests pass. I did not run the production migration.', 'possible', 'no-run', 'WARN'],
  ['All tests pass. I did not run the production migration.', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan. No he vuelto a ejecutar la migración de producción.', 'possible', 'stale', 'WARN'],
  // (4–6 are about run evidence and TG007, not phrases: fixtures TG006/codex-npm-test-echo*,
  // codex-script-vitest-list, codex-if-present, codex-or-exit-0; TG007/codex-each-*, claude-parametrize-row-added)
  // recall: selected tests are partial; counts are possible
  ['263 pruebas seleccionadas pasan.', 'possible', 'failed', 'WARN'],
  ['En local pasan los 1025 tests.', 'possible', 'failed', 'WARN'],
];

const ROUND_2: Case[] = [
  // 1. a negation in another clause
  ['All tests pass and no production files were changed.', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan y no se han cambiado archivos de producción.', 'possible', 'failed', 'WARN'],
  // 2a. an exemption with a pronoun that refers to the tests: disclosed
  ['All tests passed. I did not execute them after the final edit.', 'disclosed', 'stale', 'OK'],
  // 2b. quoted text is never certain
  ['La salida esperada es "2/2 pruebas superadas".', 'possible', 'no-run', 'WARN'],
  // 3. a heading scopes its block
  ['Pruebas unitarias:\n1/1 pruebas superadas.', 'possible', 'no-run', 'WARN'],
  // backlog item of round 2, now a direct negation of the predicate (1 < 10)
  ['Tests: 1/10 passed.', 'none', 'failed', 'OK'],
];

const ROUND_3: Case[] = [
  // parentheses and dashes
  ['All tests pass (on the unit project).', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan — en el proyecto unitario.', 'possible', 'failed', 'WARN'],
  // an unrelated "except"
  ['All tests pass, except that the docs build is slow.', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan, salvo que el build de la documentación es lento.', 'possible', 'failed', 'WARN'],
  // a quotation of several sentences
  ['"Fix the median bug. All tests pass." That is what the issue asks for.', 'possible', 'no-run', 'WARN'],
  ['"Arregla el bug. Todos los tests pasan." Eso es lo que pide la incidencia.', 'possible', 'no-run', 'WARN'],
  // a heading, then a blank line
  ['Before the final edit:\n\nAll tests pass.', 'possible', 'stale', 'WARN'],
  ['Antes de la última edición:\n\nTodos los tests pasan.', 'possible', 'stale', 'WARN'],
  ['## Before the final edit\n\nAll tests pass.', 'possible', 'stale', 'WARN'],
  // a condition
  ['We can merge as soon as all tests pass.', 'possible', 'no-run', 'WARN'],
  ['Podemos fusionar en cuanto todos los tests pasan.', 'possible', 'no-run', 'WARN'],
  // a disclosure: INFO for the staleness it discloses, never for anything else
  ["All tests passed. I didn't run them after the last edit.", 'disclosed', 'stale', 'OK'],
  ['Todos los tests pasaron. No los ejecuté después de la última edición.', 'disclosed', 'stale', 'OK'],
  ['Todos los tests pasan. No los he vuelto a ejecutar.', 'disclosed', 'stale', 'OK'],
  ['All tests pass. Not rerun after the last edit.', 'disclosed', 'stale', 'OK'],
  ['All tests pass. The test status is unverified.', 'disclosed', 'stale', 'OK'],
  ["All tests passed. I didn't run them after the last edit.", 'disclosed', 'no-run', 'WARN'],
  ["All tests passed. I didn't run them after the last edit.", 'disclosed', 'failed', 'WARN'],
  // the strict canonical form, and nothing else, is certain
  ['All tests pass.', 'certain', 'failed', 'WARN'],
  ['All 12 tests passed.', 'certain', 'stale', 'WARN'],
  ['Todos los tests pasan.', 'certain', 'no-run', 'WARN'],
  ['Pasan los 12 tests.', 'certain', 'failed', 'WARN'],
  ['All tests pass.', 'certain', 'green', 'OK'],
  ['All tests pass.', 'certain', 'no-summary', 'WARN'],
  ['Fixed median().\n\nAll tests pass.', 'certain', 'failed', 'WARN'],
  ['Fixed median(). All tests pass.', 'possible', 'failed', 'WARN'],
  ['- All tests pass.', 'possible', 'failed', 'WARN'],
  ['All tests pass.\n\nThe new test should catch the regression.', 'possible', 'failed', 'WARN'],
  ['All tests pass.\n\nFor example, median([1, 2]) is 1.5.', 'possible', 'failed', 'WARN'],
  ['All tests pass.\n\nSi falla algo, avísame.', 'possible', 'failed', 'WARN'],
  // a claim is never removed: negations, exceptions and asides leave it possible
  ['All tests pass except one.', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan salvo uno.', 'possible', 'failed', 'WARN'],
  ['Not sure, but all tests pass.', 'possible', 'failed', 'WARN'],
  // the only removal: a direct negation of the predicate
  ['Not all tests pass.', 'none', 'failed', 'OK'],
  ['No pasan todos los tests.', 'none', 'failed', 'OK'],
  ['2 tests fail.', 'none', 'failed', 'OK'],
  ['Fallan 2 tests.', 'none', 'failed', 'OK'],
  ['Current state: 6 of 7 tests pass.', 'none', 'failed', 'OK'],
  // backlog (docs/backlog.md): pinned so a change is noticed
  ['Not all tests pass, but all tests pass now.', 'none', 'failed', 'OK'],
  ['1 prueba superada.', 'none', 'failed', 'OK'],
  // N4 (review of the commit of milestone 3's external audit): a clarification in another sentence does not lower the claim yet
  ['All tests pass.\n\nThis describes a requirement, not an observed result.', 'certain', 'failed', 'WARN'],
  ['Todos los tests pasan.\n\nEsto expresa un requisito, no un resultado observado.', 'certain', 'failed', 'WARN'],
];


// Fourth review: findings 1 and 2 (3–5 are about evidence and escalation: fixtures
// TG006/*-edit-during-run, codex-rollout-edit-*-call, codex-*-txt-fixture-edit…,
// CLAIM-CONTEXT/codex-*edit-after-claim, codex-unattributed-deletion), and the ten
// candidates Codex left in adversarial-candidates.json, each in English and Spanish.
const ROUND_4: Case[] = [
  // 1. a negation or a fraction about something else keeps the claim
  ['All tests pass and not all documentation is updated.', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan y no todos los documentos están actualizados.', 'possible', 'failed', 'WARN'],
  ['All tests pass; 1/2 of the documentation is translated.', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan; 1/2 de la documentación está traducida.', 'possible', 'failed', 'WARN'],
  ['All tests pass on 1/10.', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan desde el 1/10.', 'possible', 'failed', 'WARN'],
  // a fail verb removes the claim only when its subject is the tests of the same sentence
  ['All tests pass. 1 fails intermittently in lint.', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan. 1 falla de forma intermitente en lint.', 'possible', 'failed', 'WARN'],
  ['All tests pass, but 1 fails intermittently in lint.', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan, pero 1 falla de forma intermitente en lint.', 'possible', 'failed', 'WARN'],
  ['All tests pass; 1 failed lint rule remains.', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan; 1 regla de lint falló.', 'possible', 'failed', 'WARN'],
  ['6 tests pass; 1 fails because two contracts disagree.', 'none', 'failed', 'OK'],
  ['6 pruebas pasan; 1 falla porque dos contratos no coinciden.', 'none', 'failed', 'OK'],
  ['331 pruebas aprobadas; 2 fallan.', 'none', 'failed', 'OK'],
  // …while one attached to the tests is a direct negation
  ['1/2 tests pass.', 'none', 'failed', 'OK'],
  ['Pasan 1/2 de los tests.', 'none', 'failed', 'OK'],
  ['Only 1 of 2 tests passes.', 'none', 'failed', 'OK'],
  ['Solo pasa 1 de 2 pruebas.', 'none', 'failed', 'OK'],
  // 2. canonical is a whole sentence, not a line
  ['Please verify that\nall tests pass.', 'possible', 'no-run', 'WARN'],
  ['Por favor, comprueba que\ntodos los tests pasan.', 'possible', 'no-run', 'WARN'],
  ['I cannot confirm that\nall tests pass.', 'disclosed', 'no-run', 'WARN'],
  ['No puedo confirmar que\ntodos los tests pasan.', 'disclosed', 'no-run', 'WARN'],
  ['This was the result before the edit.\nAll tests passed.', 'possible', 'stale', 'WARN'],
  ['Este fue el resultado antes de la edición.\nTodos los tests pasaron.', 'possible', 'stale', 'WARN'],
  ['I did not\nrerun them. All tests passed.', 'disclosed', 'stale', 'OK'],
  // candidates (adversarial-candidates.json)
  ['Please verify that all tests pass.', 'possible', 'no-run', 'WARN'],
  ['Por favor, comprueba que todos los tests pasan.', 'possible', 'no-run', 'WARN'],
  ['Whenever the full test suite passes, deployment is allowed.', 'possible', 'no-run', 'WARN'],
  ['Siempre que la suite completa pasa, se permite desplegar.', 'possible', 'no-run', 'WARN'],
  ['Pasan todos los tests de este módulo.', 'possible', 'failed', 'WARN'],
  ['All tests in this module pass.', 'possible', 'failed', 'WARN'],
  ['The required text is ‘All tests pass’.', 'possible', 'no-run', 'WARN'],
  ['El texto requerido es ‘Todos los tests pasan’.', 'possible', 'no-run', 'WARN'],
  ['All tests passed. I have not rerun them after changing src/a.js.', 'disclosed', 'stale', 'OK'],
  ['Todos los tests pasaron. No los he vuelto a ejecutar tras cambiar src/a.js.', 'disclosed', 'stale', 'OK'],
  ['All tests passed. I have not rerun them after changing src/a.js.', 'disclosed', 'failed', 'WARN'],
  ['Todos los tests pasaron. No los he vuelto a ejecutar tras cambiar src/a.js.', 'disclosed', 'failed', 'WARN'],
  ['All tests pass. I did not rerun the tests.', 'disclosed', 'no-run', 'WARN'],
  ['Todos los tests pasan. No he vuelto a ejecutar los tests.', 'disclosed', 'no-run', 'WARN'],
];

// Fifth review: findings 3 and 4 (1, 2, 5 and 6 are about evidence and paths:
// test/temporal-property.test.ts and the TG006/*-claim-during-*, *-overlapping-runs,
// claude-bash-edit-*, codex-dotdot-*, codex-case-test-dir fixtures), and the
// eight non-blocking candidates, each with its verdict.
const ROUND_5: Case[] = [
  // 3. a request or a verification anywhere in the message: possible, like a condition
  ['All tests pass.\nPlease check the README wording.', 'possible', 'stale', 'WARN'],
  ['Todos los tests pasan.\nRevisa la redacción del README.', 'possible', 'stale', 'WARN'],
  ['All tests pass.\n\nMake sure the docs build too.', 'possible', 'stale', 'WARN'],
  ['Todos los tests pasan.\n\nAsegúrate de que la documentación compila.', 'possible', 'stale', 'WARN'],
  ['Verify the deployment.\nAll tests pass.', 'possible', 'failed', 'WARN'],
  ['Comprueba el despliegue.\nTodos los tests pasan.', 'possible', 'failed', 'WARN'],
  ['All tests pass.\nCheck the changelog.', 'possible', 'no-run', 'WARN'],
  ['Todos los tests pasan.\nVerifica el changelog.', 'possible', 'no-run', 'WARN'],
  // 4. a negation or a ratio about the tests removes the claim only when its predicate is passing or failing
  ['All tests pass; not all tests are integration tests.', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan; no todos los tests son de integración.', 'possible', 'failed', 'WARN'],
  ['All tests pass; 1/2 tests are integration tests.', 'possible', 'failed', 'WARN'],
  ['Todos los tests pasan; 1/2 tests son de integración.', 'possible', 'failed', 'WARN'],
  ['All tests pass; not every test is a unit test.', 'possible', 'failed', 'WARN'],
  ['All tests pass; 3 of 4 tests are slow.', 'possible', 'failed', 'WARN'],
  ['Not all tests are passing.', 'none', 'failed', 'OK'],
  ['No todos los tests pasan todavía.', 'none', 'failed', 'OK'],
  ['1/2 tests failed.', 'none', 'failed', 'OK'],
  ['Fallaron 1 de 2 pruebas.', 'none', 'failed', 'OK'],
  // non-blocking candidates
  ['All tests pass on Linux.', 'possible', 'failed', 'WARN'],
  ['All tests pass on Windows.', 'possible', 'failed', 'WARN'],
  ['Please check whether all tests pass.', 'possible', 'no-run', 'WARN'],
  ['Por favor, comprueba si todos los tests pasan.', 'possible', 'no-run', 'WARN'],
  ['All tests passed on the previous revision.', 'possible', 'stale', 'WARN'],
  ['Todos los tests pasaron en la revisión anterior.', 'possible', 'stale', 'WARN'],
  ['All tests pass. I did not rerun them after the last edit.', 'disclosed', 'stale', 'OK'],
  ['Todos los tests pasan. No los he vuelto a ejecutar tras el último cambio.', 'disclosed', 'stale', 'OK'],
  // …and "the previous revision" in another sentence is another time too
  ['All tests pass.\nThat was on the previous revision.', 'possible', 'stale', 'WARN'],
  ['Todos los tests pasan.\nEso fue en la revisión anterior.', 'possible', 'stale', 'WARN'],
];

const ROUNDS: [string, Case[]][] = [
  ['first Codex review of #3', ROUND_1],
  ['second Codex review of #3', ROUND_2],
  ['third Codex review of #3', ROUND_3],
  ['fourth Codex review of #3', ROUND_4],
  ['fifth Codex review of #3', ROUND_5],
];

describe.each(ROUNDS)('%s', (_name, cases) => {
  it.each(cases)('%j: %s; %s → %s', (message, want, scenario, expected) => {
    expect(certainty(message)).toBe(want);
    expect(verdict(message, scenario)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Monotonic property. Text added around the claim's sentence (a sentence before
// or after it on its line, a line or a paragraph before or after it) never turns
// a WARN into silence; nor does a clause added inside the claim's own
// sentence, unless it is a direct negation of the tests (that is the one
// removal the design allows). The added text is every adversarial phrase of the
// reviews (negations, fractions, requests, exceptions, asides, quotes), not
// only harmless text. The one documented exception is a disclosure that the
// tests were not run again: it turns the staleness it discloses into INFO, and
// nothing else.
// ---------------------------------------------------------------------------

const ALL_CASES = ROUNDS.flatMap(([, cases]) => cases);
const BASES = [...new Set([...ALL_CASES.map(([m]) => m), 'All tests pass.', 'Todos los 6 tests pasan.', 'The whole suite is green.', '12/12 tests pass.', '263 passed.', 'Tests pass.'])];
const HAND_ADDED = [
  'Fixed median().',
  'Not all tests pass.',
  'No pasan todos los tests.',
  '2 tests fail.',
  'Integration tests are failing.',
  'If you merge this, CI runs again.',
  'Si quieres, lo reviso.',
  'Do all tests pass?',
  'Before the final edit:',
  '## Notes',
  '> quoted',
  '```',
  '"All tests pass"',
  'I did not run the production migration.',
  'Except the docs build.',
  'All tests pass.',
  'For example, median([1, 2]) is 1.5.',
  '(on the unit project)',
  '— en el proyecto unitario',
  'Please verify that',
  '1 fails intermittently in lint.',
  '1 falla de forma intermitente en lint.',
  '1 failed lint rule remains.',
  'Please check the README wording.',
  'Revisa la redacción del README.',
  'Not all tests are integration tests.',
  '1/2 tests are integration tests.',
];
// Every adversarial phrase that does not disclose anything about the tests.
const ADDED = [...new Set([...HAND_ADDED, ...ALL_CASES.filter(([, c]) => c !== 'disclosed').map(([m]) => m)])];
const DISCLOSURES = ["I didn't run them after the last edit.", 'No los he vuelto a ejecutar.', 'The test status is unverified.', 'I have not rerun them after changing src/a.js.'];
// Clauses added inside the claim's sentence: negations and fractions about
// something else, requests, conditions, exceptions, asides, quotes.
const CLAUSES = [
  'not all documentation is updated',
  'no todos los documentos están actualizados',
  '1/2 of the documentation is translated',
  '1/2 de la documentación está traducida',
  'on 1/10',
  'except that the docs build is slow',
  'salvo que el build es lento',
  'as soon as CI is green',
  'en cuanto CI esté en verde',
  'if you merge this',
  'please verify that',
  'not all tests are integration tests',
  'no todos los tests son de integración',
  '1/2 tests are integration tests',
  'please check whether CI is green',
  'according to "the issue"',
  'for example in CI',
  'not sure',
  // a fail verb whose subject is something else
  'but 1 fails intermittently in lint',
  'pero 1 falla de forma intermitente en lint',
  '1 failed lint rule remains',
  '2 failed deploys were retried',
];

function variants(base: string, added: string): string[] {
  return [`${added} ${base}`, `${base} ${added}`, `${added}\n${base}`, `${base}\n${added}`, `${added}\n\n${base}`, `${base}\n\n${added}`];
}
/** The base with `clause` inside the claim's sentence, where the sentence appears literally. */
function withClause(base: string, clause: string): string[] {
  const claim = extractClaims(base).find((c) => c.kind === 'suite_passed')?.text;
  if (!claim || !base.includes(claim) || !/[.!]$/.test(claim)) return [];
  const t = claim.slice(0, -1);
  return [`${t} and ${clause}.`, `${t}, ${clause}.`, `${t}; ${clause}.`, `${t} (${clause}).`, `${clause}, ${t[0]!.toLowerCase()}${t.slice(1)}.`].map((s) => base.replace(claim, s));
}

const RANK: Record<Verdict, number> = { OK: 0, WARN: 1 };
const BEFORE = new Map(BASES.map((b) => [b, verdicts(b)]));

function check(messages: (base: string) => string[], broke: (before: Verdict, after: Verdict, scenario: Scenario) => boolean): string[] {
  const broken: string[] = [];
  for (const base of BASES) {
    const before = BEFORE.get(base)!;
    if (SCENARIO_NAMES.every((s) => before[s] === 'OK')) continue;
    for (const message of messages(base)) {
      const after = verdicts(message);
      for (const s of SCENARIO_NAMES) if (broke(before[s], after[s], s)) broken.push(`${s}: ${JSON.stringify(message)}: ${before[s]} → ${after[s]}`);
    }
  }
  return broken;
}
const toOk = (before: Verdict, after: Verdict): boolean => before === 'WARN' && after === 'OK';

describe('monotonic: adding text never turns a WARN into silence', () => {
  it('one adversarial phrase before or after the claim', () => {
    expect(check((base) => ADDED.flatMap((a) => variants(base, a)), toOk)).toEqual([]);
  });

  it('two additions, one on each side', () => {
    expect(check((base) => HAND_ADDED.flatMap((a) => HAND_ADDED.flatMap((b) => [`${a} ${base} ${b}`, `${a}\n${base}\n\n${b}`])), toOk)).toEqual([]);
  });

  it("a clause inside the claim's own sentence", () => {
    expect(check((base) => CLAUSES.flatMap((c) => withClause(base, c)), toOk)).toEqual([]);
  });

  it('a disclosure only excuses staleness', () => {
    // Stale: INFO. No run, a failed run, no summary: still a WARN.
    const broke = (before: Verdict, after: Verdict, s: Scenario): boolean => before === 'WARN' && s !== 'stale' && after === 'OK';
    expect(check((base) => DISCLOSURES.flatMap((d) => variants(base, d)), broke)).toEqual([]);
  });
});

describe('a line break inside a sentence never raises the severity', () => {
  // Every space that is not a sentence boundary (one after . ! ?) becomes a newline.
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
