// Claims in an agent's final message, found with deterministic English and
// Spanish patterns (never an LLM).
//
// MONOTONIC by design: adding text to a message can only lower a suite claim's
// certainty, never remove it.
//
// A suite claim is CERTAIN only in the strict canonical form: the whole sentence
// is the global claim ("All tests pass.", "All 6 tests passed.", "Todos los
// tests pasan.", "12/12 tests pass."), alone on its line (no list marker, no
// other sentence, not continued from the line before: sentences are read as
// written, so "Please verify that\nall tests pass." is one sentence), with no
// parentheses, dashes, quotes or backticks, no heading anywhere before it (a
// line ending in ':' or a Markdown '#'; blank lines do not end it), and nothing
// in the whole message that marks a condition, a quotation, an example or
// another time ("if", "once", "when", "should", "expected", "example",
// "before", "si", "en cuanto", "cuando", "debería", "esperada", "antes", a '>'
// or '"' …) or says tests are failing now.
//
// Anything else that reads like a suite claim is POSSIBLE (TG006 and TG007
// are at most a WARN whatever the certainty; it shows in the wording and in
// the statistics). Negations, exceptions and asides in the
// sentence leave it possible ("All tests pass except one."); a claim is never
// dropped for doubt. The only sentences with no claim are a direct negation of
// the predicate, attached to the tests ("not all tests pass", "no pasan
// todos", "2 tests fail", "6 of 7 tests pass"; not "not all documentation is
// updated" or "1/2 of the docs"), and a question.
//
// An explicit disclosure that the tests were not run again ("I did not rerun
// them", "not rerun", "unverified", "no los he vuelto a ejecutar") makes the
// claim DISCLOSED: TG006 reports staleness as INFO, and anything else it finds
// (no run, a failed run) as WARN.
//
// Tests-added and regression claims are only read from plain sentences.
import type { ClaimCertainty, ClaimKind } from '../evidence/schema.js';

export interface ExtractedClaim {
  kind: ClaimKind;
  /** The sentence, with markdown removed. */
  text: string;
  certainty: ClaimCertainty;
}

// `\b` only knows ASCII letters: after "ó", "á", "í" a Spanish word ends here.
const END = String.raw`(?![\wáéíóúñ])`;
const NOUN_EN = String.raw`(?:tests?|specs?|test\s+cases)`;
const NOUN_ES = String.raw`(?:tests?|pruebas|casos\s+de\s+prueba)`;
const PASS_EN = String.raw`(?:pass(?:es|ed|ing)?|succeed(?:s|ed)?|(?:are|were|is)\s+green|green)`;
const PASS_ES = String.raw`(?:pasan|pasaron|pasaban|han\s+pasado|est[aá]n\s+en\s+verde|se\s+superan|superan)`;
const TEST_CONTEXT = /\btests?\b|\bspecs?\b|\bsuite\b|\bpruebas\b|\bbater[ií]a\b/;

const SUITE: RegExp[] = [
  // all (the) (6) (unit) tests (now) pass
  new RegExp(String.raw`\ball\b(?:\s+(?:of\s+)?(?:the|my|our|\d+|existing|remaining|unit|integration|e2e|new|affected|relevant|selected|specific|targeted|filtered|modified|changed|related|python|vitest|jest|pytest))*\s+${NOUN_EN}\b.*?\b${PASS_EN}\b`),
  // the full / whole / entire test suite passes
  new RegExp(String.raw`\b(?:full|whole|entire|complete)\s+(?:test\s+)?suite\b.*?\b${PASS_EN}\b`),
  new RegExp(String.raw`\btest\s+suite\s+(?:now\s+)?(?:pass(?:es|ed)?|is\s+(?:passing|green)|succeed(?:s|ed)?)\b`),
  /\bevery\s+(?:single\s+)?(?:test|spec)\s+(?:now\s+)?(?:pass(?:es|ed)?|is\s+passing)\b/,
  /\b(\d+)\s*\/\s*\1\s+(?:tests?\s+)?(?:pass(?:ed|ing)?|green)\b/,
  /\b(\d+)\s+of\s+\1\s+tests?\s+pass(?:ed|ing)?\b/,
  /\b\d+\s+(?:tests?\s+)?passed,?\s+zerofail\b/,
  /\b\d+\s+passing,?\s+zerofail\b/,
  // todos los (6) tests pasan / pasan todos los tests / la suite completa pasa
  new RegExp(String.raw`\btod[oa]s\s+(?:l[oa]s\s+)?(?:\d+\s+)?${NOUN_ES}\b.*?\b${PASS_ES}\b`),
  new RegExp(String.raw`\b(?:pasan|pasaron|han\s+pasado)\s+tod[oa]s\s+(?:l[oa]s\s+)?(?:\d+\s+)?${NOUN_ES}\b`),
  new RegExp(String.raw`\b(?:suite|bater[ií]a)(?:\s+de\s+(?:tests?|pruebas))?(?:\s+(?:completa|entera))?\s+(?:ya\s+)?(?:pasa|pas[oó]|est[aá]\s+en\s+verde)${END}`),
  /\b(\d+)\s*\/\s*\1\s+(?:tests?|pruebas)\s+(?:pasan|en\s+verde)\b/,
  /\b(\d+)\s+de\s+\1\s+(?:tests?|pruebas)\s+pasan\b/,
  // the definite article and a count name the whole set: "the 562 tests pass", "pasan los 562 tests"
  /\bthe\s+\d+\s+tests?\s+(?:now\s+|all\s+)?pass(?:es|ed|ing)?\b/,
  /\bpasan\s+(?:l[oa]s|tod[oa]s\s+l[oa]s)\s+\d+\s+(?:tests?|pruebas)\b/,
  /\bl[oa]s\s+\d+\s+(?:tests?|pruebas)\s+(?:ya\s+)?pasan\b/,
  // "pasan el lint y los 129 tests"
  /\bpasan\b[^.;]{0,40}?\bl[oa]s\s+\d+\s+(?:tests?|pruebas)\b/,
  // N/N with a pass word: "148/148 tests superados", "41/41 tests … correctos", "412/412 de la suite, sin fallos", "Tests: 31/31 superados"
  new RegExp(String.raw`\b(\d+)\s*\/\s*\1\s+(?:tests?|pruebas|specs?|de\s+la\s+suite)\b.*?(?:pasan|superad[oa]s|aprobad[oa]s|correct[oa]s|\bok\b|en\s+verde|pass(?:ed|ing)?|green|zerofail)`),
  new RegExp(String.raw`\b(?:tests?|pruebas)\b[^.;]{0,20}?\b(\d+)\s*\/\s*\1\b[^.;]*?(?:pasan|superad[oa]s|aprobad[oa]s|correct[oa]s|\bok\b|en\s+verde|pass(?:ed|ing)?|green|zerofail)`),
];
/**
 * A count without a quantifier ("7 passed", "331 pruebas aprobadas"): it may be
 * the whole suite or a subset, so it is at most a POSSIBLE claim, and none when
 * the message mentions a failure or the count is "N of M".
 */
const COUNT_ONLY: RegExp[] = [
  /\b\d+\s+(?:tests?\s+)?(?:passed|passing)\b/,
  /\b\d+\s+tests?\s+pass(?:es)?\b/,
  new RegExp(String.raw`\b\d+\s+(?:tests?|pruebas)\s+(?:[\wáéíóúñ]+\s+)?(?:pasan|pasaron|superad[oa]s|aprobad[oa]s|correct[oa]s)${END}`),
  /\b(?:pasan|pasaron)\s+\d+\s+(?:tests?|pruebas)\b/,
  // "199/199 tests" with no verb: all of something, but not said to pass
  /\b(\d+)\s*\/\s*\1\s+(?:tests?|pruebas)\b/,
  // "the existing / current suite passes": not said to be the whole suite
  /\bsuite\s+(?:existente|actual|local|existing|current)\s+(?:ya\s+)?(?:pasa|passes)\b/,
  // a count in a list that ends in a pass verb: "511 tests, typecheck y build pasan"
  new RegExp(String.raw`\b\d+\s+(?:tests?|pruebas)\b[^.;]*\b(?:pasan|pass)${END}`),
];
// Need a word for tests elsewhere in the sentence: "Tests: npm test — all 6 passed", "Tests: todos pasan".
const SUITE_IN_CONTEXT: RegExp[] = [
  /\ball\s+(?:\d+\s+)?(?:pass(?:ed|es|ing)?|green)\b/,
  /\ball\s+green\b/,
  /\btod[oa]s\s+(?:l[oa]s\s+\d+\s+)?(?:pasan|pasaron|pasaban|han\s+pasado)\b/,
  /\btodo\s+(?:est[aá]\s+)?en\s+verde\b/,
  /\btodo\s+pasa\b/,
];

const TESTS_ADDED: RegExp[] = [
  new RegExp(String.raw`\b(?:added|adding|add|wrote|written|writing|created|creating|introduced)\b(?:\s+[\w-]+){0,3}?\s+(?:new\s+)?(?:unit\s+|regression\s+|integration\s+)?${NOUN_EN}\b`),
  /\bnew\s+(?:unit\s+|regression\s+|integration\s+)?(?:tests?|test\s+cases?)\s+(?:for|to|that|cover)/,
  /\b(?:tests?|specs?)\s+added\b/,
  new RegExp(String.raw`(?:añad[íi]|a[ñn]adido|agregu[ée]|agregado|escrib[íi]|escrito|cre[ée]|creado|incorpor[ée])${END}(?:\s+[\wáéíóúñ]+){0,3}?\s+(?:tests?|pruebas?|casos\s+de\s+prueba)\b`),
  /\b(?:nuevos?|nuevas?)\s+(?:tests?|pruebas?)\b/,
  /\b(?:tests?|pruebas?)\s+(?:añadid[oa]s|agregad[oa]s)\b/,
];
const REGRESSION_NOUN =
  /\bregression\s+(?:tests?|coverage|specs?|test\s+cases?|cases?)\b|\b(?:tests?|pruebas?|casos?)\s+de\s+regresi[oó]n\b|\bregresiones\b|\b(?:tests?|pruebas?)\s+(?:para|que|to|that)\s+(?:impedir|evitar|cubrir|detectar|prevent|catch|cover|guard\s+against)\s+(?:esa|la|una|esta|that|the|this|a)\s+(?:regresi[oó]n|regression)(?![\wáéíóúñ])/;
const REGRESSION_VERB = /\b(?:added|adding|add|wrote|written|created|introduced|includes?|included|new|covers?|covering)\b|a[ñn]ad|agreg|escrib|\bcre[ée]|\bcread|incorpor|nuev|incluy|cubr/;

/** Phrases that state zero failures; masked before looking for negations. */
const ZERO_FAILURES =
  /\b0\s+(?:failed|failures|failing|errors?)\b|\bzero\s+(?:failures|errors)\b|\bno\s+(?:failures|failing\s+tests|errors)(?:\s+or\s+(?:skips|skipped\s+tests|errors))?\b|\b0\s+fall(?:os|idos|an)\b|\bsin\s+(?:fallos|errores)(?:\s+ni\s+(?:omisiones|errores|fallos|saltos))?\b/g;
const NEGATION = new RegExp(
  String.raw`\bnot\b|n't\b|\bno\b|\bnever\b|\bnone\b|\bnor\b|\bcannot\b|\bunable\b|\bfail(?:s|ed|ing|ure|ures)?\b|\bexcept\b|\bbut\s+(?:one|two|three|\d+)\b|\bbroken\b|\berrors?\b|` +
    String.raw`\bnunca\b|\bning[uú]n[oa]?${END}|\bnada\b|\bni\b|\bfall(?:a|an|aron|ó|o|os|ando|ido|idos)${END}|\berror(?:es)?\b|\bexcepto\b|\bsalvo\b|\bmenos\b|\bpero\s+(?:uno|una|dos|tres|\d+)\b|\bimposible\b`,
);
const TEMPORAL =
  /\bbefore\b|\bearlier\b|\bprevious(?:ly)?\b|\banterior(?:es)?\b|\binitially\b|\bat\s+first\b|\bprior\s+to\b|\boriginally\b|\bused\s+to\b|\blast\s+time\b|\bat\s+the\s+start\b|\bon\s+the\s+old\s+code\b|\bwithout\s+the\s+fix\b|\bon\s+base\b|\bantes\b|\banteriormente\b|\bpreviamente\b|\binicialmente\b|\bal\s+principio\b|\boriginalmente\b|\ben\s+la\s+(?:ejecuci[oó]n|pasada)\s+anterior\b|\bsin\s+el\s+arreglo\b|\bcon\s+el\s+c[oó]digo\s+antiguo\b|\byesterday\b|\blast\s+(?:week|night|session)\b|\bthis\s+morning\b|\bayer\b|\bla\s+semana\s+pasada\b|\besta\s+ma[ñn]ana\b|\ben\s+la\s+sesi[oó]n\s+anterior\b/;
const HEDGE = new RegExp(
  String.raw`\bexpect(?:s|ed)?\b|\bshould\b|\bwould\b|\bprobably\b|\blikely\b|\bpresumably\b|\bi\s+(?:believe|think|assume|guess)\b|\bassum(?:e|ing)\b|\bhopefully\b|\bin\s+theory\b|\bought\s+to\b|\bmight\b|\bmay\b|\bseems?\b|\bappears?\b|` +
    String.raw`\bdeber[ií]a(?:s|n|mos)?${END}|\bespero\b|\bprobablemente\b|\bsupongo\b|\bcreo\s+que\b|\ben\s+teor[ií]a${END}|\bpresumiblemente\b|\bquiz[aá]s?${END}|\bparece\b`,
);
// Not an assertion about what happened: the request, a plan, a condition, an
// instruction to the user ("you asked me to make all tests pass", "all tests
// will pass once…", "run npm test to check that all tests pass").
const NOT_ASSERTED = new RegExp(
  String.raw`\bask(?:ed|s)?\b|\bgoal\b|\bto\s+make\b|\bmake\s+(?:all|every|the)\b|\bwill\b|\bwon't\b|\bif\b|\bonce\b|\bunless\b|\bwhen\b|\bso\s+that\b|\bin\s+order\s+to\b|\b(?:check|verify|confirm|ensure|make\s+sure)\s+(?:that|whether|if)\b|^(?:run|try|please)\b|` +
    // conditions: "provided all tests pass, we can merge"
    String.raw`\bprovid(?:ed|ing)\b|\bas\s+long\s+as\b|\bon\s+condition\b|\bin\s+case\b|\bonly\s+if\b|` +
    // requirements and reported speech: "the task says all tests must pass"
    String.raw`\bmust\b|\bneeds?\s+to\b|\bha(?:ve|s)\s+to\b|\brequire[sd]?\b|\brequirements?\b|\bsays?\b|\bsaid\b|\bstates?\b|\baccording\s+to\b|\bacceptance\s+criteri|` +
    String.raw`\bped(?:iste|ido|ía)${END}|\bobjetivo\b|\bpara\s+(?:que|comprobar|verificar|hacer)\b|\bhacer\s+que\b|\bsi\b|\bcuando\b|\buna\s+vez\s+que\b|\bpasar[áa]n${END}|^(?:ejecuta|comprueba|verifica|confirma|aseg[uú]rate)${END}|` +
    String.raw`\bsiempre\s+que\b|\bcon\s+tal\s+de\s+que\b|\bmientras\b|\bdeben?\b|\btienen?\s+que\b|\bhay\s+que\b|\brequiere${END}|\bdice\b|\bseg[uú]n${END}|\bcriterios?\s+de\s+aceptaci`,
);
const EXEMPTION =
  /\b(?:haven't|have\s+not|didn't|did\s+not)\s+(?:re-?)?execut(?:e|ed)\b|\bnot\s+(?:re-?)?executed\b|\bunverified\b|\bnot\s+(?:been\s+)?verified\b|\bcan(?:'t|not)\s+(?:confirm|verify|be\s+sure)\b|\bcould(?:n't|\s+not)\s+(?:confirm|verify|run)\b|\bunable\s+to\s+(?:confirm|verify|run)\b|\bnot\s+(?:re-?)?run\b|\b(?:haven't|have\s+not|didn't|did\s+not)\s+(?:re-?)?run\b|\bwithout\s+(?:re-?)?running\b|\buntested\b|\bnot\s+tested\b|\b(?:didn't|did\s+not)\s+test\b|\bsin\s+verificar\b|\bno\s+verificad[oa]s?\b|\bno\s+(?:he|hemos)\s+(?:podido\s+)?(?:verificar|confirmar|ejecutar|(?:volver|vuelto)\s+a\s+(?:ejecutar|correr|lanzar)|re-?ejecutar|correr)\b|\bno\s+puedo\s+(?:confirmar|verificar|asegurar)\b|\bsin\s+(?:volver\s+a\s+)?ejecutar\b|\bno\s+(?:los|las)\s+(?:he|hemos)\s+(?:vuelto\s+a\s+)?(?:ejecutad[oa]s?|ejecutar|correr|lanzar)\b|\bno\s+se\s+han\s+(?:vuelto\s+a\s+)?ejecutado\b/;

/** A statement that tests fail now (not "failed before the fix"). */
const FAILING_NOW = new RegExp(String.raw`(?:\btests?\b|\bspecs?\b|\bsuite\b|\bpruebas\b).*(?:\bfail(?:s|ing|ed)?\b|\bbroken\b|\bred\b|\bfall(?:a|an|aron|ando)${END})|(?:\bfail(?:s|ing|ed)?\b|\bfall(?:a|an|aron)${END}).*(?:\btests?\b|\bpruebas\b)`);
/** Exemptions that are about tests by their very words. */
const EXEMPTION_TESTS = /\buntested\b|\bnot\s+tested\b|\b(?:didn't|did\s+not|haven't|have\s+not)\s+(?:re-?)?test(?:ed)?\b|\bsin\s+probar\b/;
/** Explicit disclosure that the tests were not run again: "I didn't run them after the last edit", "no los ejecuté después". */
const DISCLOSURE = new RegExp(
  String.raw`\b(?:didn't|did\s+not|haven't|have\s+not)\s+(?:re-?)?(?:run|execute[d]?)\s+(?:them|the\s+tests|the\s+suite)\b|\bnot\s+(?:been\s+)?re-?run\b|` +
    String.raw`\bno\s+(?:los|las)\s+(?:ejecut[ée]|corr[ií]|lanc[ée]|volv[ií]\s+a\s+ejecutar|he\s+(?:vuelto\s+a\s+)?(?:ejecutar|ejecutado|correr|lanzar))(?![\wáéíóúñ])`,
);
const PASS_WORD = new RegExp(String.raw`\bpass(?:es|ed|ing)?\b|\bpas(?:an|aron|en|a)${END}|\bgreen\b|\bverde\b`);
const PRONOUN = /\b(?:them|they|it)\b|\b(?:los|las)\b/;

export interface Unit {
  /** The sentence, with markdown removed. */
  text: string;
  /** The sentence with quoted text (backticks, double or angle quotes) blanked out. */
  plain: string;
  /** Inside a blockquote (`> …`) or a fenced code block. */
  quoted: boolean;
  /** The line ending in ':' that introduces it within its paragraph, if any. */
  heading: string | null;
  /** The sentence is its whole line: no other sentence, no list marker, no `#`, not continued from the line before. */
  alone: boolean;
  /** A heading (a line ending in ':' or a Markdown `#` heading) comes anywhere before it; blank lines do not end it. */
  afterHeading: boolean;
  /**
   * Two lines that a heading, quote, list or code marker kept apart in the middle of a sentence, read
   * as one: the joined reading may hold a claim neither line holds alone. Always quoted (possible).
   */
  bridge?: true;
}

const QUOTED = /`[^`]*`|"[^"]*"|«[^»]*»/g;
const BLOCK_MARKER = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)+/;

/** A line of text as written, possibly continued over several physical lines. */
interface TextLine {
  text: string;
  /** Inside a code block, on a fence line, or in a blockquote. */
  quoted: boolean;
  code: boolean;
  /** Its first physical line had a list, heading or quote marker. */
  prefixed: boolean;
  /** A Markdown `#` heading. */
  mdHeading: boolean;
  /** Physical lines it spans. */
  lines: number;
}

/**
 * Physical lines → lines of text. A sentence wrapped over several lines is one
 * sentence: a line continues the one before when that one does not end a
 * sentence (`.`, `!`, `?`) or introduce a block (`:`), is not a heading, and
 * the line has no list or heading marker of its own. Code lines join only with
 * code lines (and stay quoted): a fence never splits a sentence and erases its claim.
 */
function textLines(message: string): (TextLine | 'blank' | 'fence')[] {
  const out: (TextLine | 'blank' | 'fence')[] = [];
  let fenced = false;
  for (let raw of message.split('\n')) {
    // A fence line: text after the backticks is kept, as quoted text (never dropped).
    let fenceLine = false;
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      fenceLine = true;
      raw = raw.replace(/^\s*```+/, '');
    }
    const code = fenced || fenceLine;
    const quoted = code || /^\s*>/.test(raw);
    const text = raw.replace(BLOCK_MARKER, '').trim();
    if (!text) {
      out.push(fenceLine ? 'fence' : 'blank');
      continue;
    }
    const prev = out[out.length - 1];
    const marker = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/.test(raw);
    if (typeof prev === 'object' && prev.code === code && !prev.mdHeading && !marker && prev.quoted === quoted && !/[.!?:]["'“”‘’»)]*$/.test(prev.text)) {
      prev.text += ` ${text}`;
      prev.lines++;
      continue;
    }
    out.push({ text, quoted, code, prefixed: raw.trim() !== text, mdHeading: /^\s*#{1,6}\s/.test(raw), lines: 1 });
  }
  return out;
}

/** Markdown and typography out, one sentence per entry, with the context that governs it. */
export function units(message: string): Unit[] {
  const out: Unit[] = [];
  let heading: string | null = null;
  let seenHeading = false;
  // The previous line of text, when nothing (a blank line, a fence) separates it from this one.
  let prev: { text: string; last: string } | null = null;
  for (const l of textLines(message)) {
    if (l === 'blank') heading = null; // a blank line ends the paragraph a heading governs (not "afterHeading")
    if (typeof l !== 'object') {
      prev = null;
      continue;
    }
    const line = l.text
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\*\*|__|~~/g, '')
      .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|[.,;:!?]|$)/g, '$1$2')
      .trim();
    if (!line) {
      prev = null;
      continue;
    }
    // A sentence ends at . ! ? — also inside a closing quote or parenthesis (`"…pass." Next`).
    const parts = line.split(/(?<=[.!?]["'»)]*)\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
    for (const t of parts) {
      out.push({
        text: t.replace(/`([^`]*)`/g, '$1'),
        plain: t.replace(QUOTED, ' … '),
        quoted: l.quoted,
        heading: l.code ? null : heading,
        alone: parts.length === 1 && !l.prefixed && !l.quoted && l.lines === 1,
        afterHeading: seenHeading,
      });
    }
    // The line before did not end its sentence, but was kept apart (a marker, a heading, a quote, code):
    // the joined reading too, so that no prefix on a line can erase a claim.
    if (prev && !/[.!?:]["'»)]*$/.test(prev.text)) {
      const t = `${prev.last} ${parts[0]!}`;
      out.push({ text: t.replace(/`([^`]*)`/g, '$1'), plain: t.replace(QUOTED, ' … '), quoted: true, heading: null, alone: false, afterHeading: seenHeading, bridge: true });
    }
    prev = { text: line, last: parts[parts.length - 1]! };
    if (!l.code && (line.endsWith(':') || l.mdHeading)) {
      heading = line.replace(/`([^`]*)`/g, '$1');
      seenHeading = true;
    }
  }
  return out;
}

export function sentences(message: string): string[] {
  return units(message).filter((u) => !u.bridge).map((u) => u.text);
}

const lower = (s: string): string => s.toLowerCase().replace(ZERO_FAILURES, 'zerofail');

/**
 * The only CERTAIN suite claims: the whole sentence is the global claim, and
 * nothing else ("All tests pass.", "All 12 tests passed.", "Todos los tests
 * pasan.", "Pasan los 12 tests.").
 */
const CANONICAL: RegExp[] = [
  /^all (?:the )?(?:\d+ )?tests (?:now )?(?:pass|passed|are passing|have passed)[.!]?$/,
  /^(?:the )?(?:full |whole |entire )?(?:test )?suite (?:now )?(?:passes|passed|is passing|is green)[.!]?$/,
  /^every test (?:now )?(?:passes|passed)[.!]?$/,
  /^(\d+)\/\1 tests (?:pass|passed)[.!]?$/,
  /^tod[oa]s (?:l[oa]s )?(?:\d+ )?(?:tests|pruebas) (?:pasan|pasaron|han pasado)[.!]?$/,
  /^pasan (?:tod[oa]s )?l[oa]s (?:\d+ )?(?:tests|pruebas)[.!]?$/,
  /^la (?:suite|bater[ií]a de (?:tests|pruebas)) (?:completa |entera )?(?:pasa|ha pasado)[.!]?$/,
  /^(\d+)\/\1 (?:tests|pruebas) (?:pasan|superad[oa]s)[.!]?$/,
];
/** Anywhere in the message, these make every claim in it at most possible: a condition, a quotation, an example. */
const MESSAGE_MARKERS = new RegExp(
  String.raw`\bif\b|\bprovid(?:ed|ing)\b|\bas\s+soon\s+as\b|\bonce\b|\bwhen(?:ever)?\b|\bunless\b|\buntil\b|\bexamples?\b|\be\.g\.|\bfor\s+instance\b|\bexpect(?:s|ed|ation)?\b|\bshould\b|\bwould\b|\bcould\b|\bmight\b|\bmay\b|\bmust\b|\bassum(?:e|ing)\b|\bsuppose\b|\bquot(?:e|ed|es)\b|\bsays?\b|\bsaid\b|` +
    String.raw`\bsi\b|\ben\s+cuanto\b|\bcuando\b|\buna\s+vez\s+que\b|\bsiempre\s+que\b|\ba\s+menos\s+que\b|\bhasta\s+que\b|\bejemplos?\b|\bp\.\s?ej\.|\besperad[oa]s?\b|\bespera(?:ba|mos)?\b|\bdeber[ií]a(?:s|n|mos)?${END}|\bdeben?\b|\bpodr[ií]a(?:s|n)?${END}|\bsupon|\bcita\b|\bdice\b|\bdec[ií]a${END}|` +
    // a request or a verification: the reader is asked to check something
    String.raw`\bplease\b|\bverify\b|\bcheck\b|\bmake\s+sure\b|\bensure\b|\bconfirm\b|\bpor\s+favor\b|\bcomprueb[ae]${END}|\bverifi(?:ca|que)${END}|\brevis[ae]${END}|\baseg[uú]r(?:ate|ese)${END}|\bconfirm[ae]${END}`,
);
const QUOTE_MARKS = /["“”«»]|^\s*>|^\s*```/m;
/**
 * A direct negation of the claim's own predicate: the only thing that leaves a
 * sentence with no claim ("not all tests pass", "no pasan todos", "2 tests
 * fail", "6 of 7 tests pass").
 */
// The negation must be attached to the tests: "not all tests", "no todos los
// tests", "2 tests fail", "1/2 tests pass". One about something else ("not all
// documentation is updated", "1/2 of the docs") leaves the claim.
// (the) (6) (unit) tests: the noun the quantifier is attached to
const TESTS_EN = String.raw`(?:of\s+)?(?:the\s+)?(?:\d+\s+)?(?:[\w-]+\s+)?(?:tests?|specs?|test\s+cases)\b`;
const TESTS_ES = String.raw`(?:l[oa]s\s+)?(?:\d+\s+)?(?:tests?|pruebas|casos\s+de\s+prueba)${END}`;
// …and it must bear on passing or failing: "not all tests are integration
// tests", "1/2 tests are integration tests" keep the claim.
const PRED_EN = String.raw`\s*(?:(?:do|does|did|are|were|is|was|have|has|had|will|now|yet|currently|all)\s+)*(?:pass(?:es|ed|ing)?|fail(?:s|ed|ing)?|succeed(?:s|ed)?|green|red|broken)\b`;
const PRED_ES = String.raw`\s+(?:(?:ya|todav[ií]a|a[uú]n|se|est[aá]n|han)\s+)*(?:pasan|pasaron|pasaban|pasado|fallan|fallaron|fallado|superan|superado|en\s+verde|en\s+rojo)${END}`;
const DIRECT_NEGATION: RegExp[] = [
  new RegExp(String.raw`\bnot\s+(?:all|every)\s+${TESTS_EN}${PRED_EN}|\bnot\s+all\s+(?:of\s+them\s+)?pass`),
  new RegExp(String.raw`\bnot\s+the\s+(?:whole|full|entire)\s+(?:test\s+)?suite${PRED_EN}`),
  new RegExp(String.raw`\b(?:all|every)\s+${TESTS_EN}\s*(?:do|does|did|are|were|have|has|will)(?:n't|\s+not)\s+pass`),
  new RegExp(String.raw`\b(?:none|no)\s+${TESTS_EN}\s*pass`),
  new RegExp(String.raw`\b(?:couldn't|could\s+not|can't|cannot|didn't|did\s+not|unable\s+to|failed\s+to)\s+(?:make|get)\s+(?:all|every)\s+${TESTS_EN}\s*(?:to\s+)?(?:pass|green|succeed)\b`),
  // "2 tests fail", "2 integration tests are failing": the tests are the subject.
  new RegExp(String.raw`\b\d+\s+(?:[\w-]+\s+)?(?:tests?|specs?)\s+(?:are\s+)?fail(?:s|ed|ing)?\b`),
  new RegExp(String.raw`\bno\s+pasan\s+tod[oa]s\s+${TESTS_ES}|\bno\s+tod[oa]s\s+${TESTS_ES}${PRED_ES}|\bno\s+(?:pasan\s+tod[oa]s|tod[oa]s\s+pasan)${END}|\btod[oa]s\s+${TESTS_ES}\s+no\s+pasan${END}|\bning[uú]n\s+test\s+pasa${END}|\bninguna\s+prueba\s+pasa${END}`),
  // "2 pruebas fallan", "fallan 2 tests"
  new RegExp(String.raw`\b\d+\s+(?:tests?|pruebas)\s+(?:[\wáéíóúñ]+\s+)?fall(?:an|aron|a)${END}|\bfall(?:an|aron)\s+\d+\s+(?:tests?|pruebas)${END}`),
];
// A count with a fail verb and no subject of its own ("1 fails", "2 fallan",
// "fallan 2"): the tests are its subject only when the same sentence counted
// tests before it ("6 tests pass; 1 fails because…", "331 pruebas aprobadas;
// 2 fallan") and nothing after the verb gives it another one ("1 fails
// intermittently in lint", "1 failed lint rule").
const BARE_FAIL = new RegExp(
  String.raw`\b\d+\s+fail(?:s|ed|ing)?|\b\d+\s+fall(?:an|aron|a|ó)${END}|\bfall(?:an|aron)\s+\d+`,
  'g',
);
const FAIL_TAIL = new RegExp(String.raw`^(?:\s*(?:[.,;:)!]|$)|\s+(?:because|since|as|due\s+to|porque|ya\s+que|debido\s+a|por)\b)`);
const TESTS_COUNTED = new RegExp(String.raw`\b\d+\s+(?:[\w-]+\s+)?(?:tests?|specs?|test\s+cases|pruebas)${END}|\b(?:tests?|specs?|pruebas)\s*:\s*\d+`);
// "6 of 7 tests", "1/2 tests pass", "Tests: 1/10 passed", "1 de 2 pruebas": a
// count below its total, attached to the tests or to their pass verb.
const RATIO = /\b(\d+)\s*(?:\/|of|de)\s*(\d+)\b/g;
const RATIO_AFTER = new RegExp(
  String.raw`^\s+(?:(?:of|de|the|l[oa]s)\s+){0,2}(?:[\w-]+\s+)?(?:tests?|specs?|pruebas|test\s+cases)${END}(?:${PRED_EN}|${PRED_ES})|^\s+(?:pass(?:es|ed|ing)?|fail(?:s|ed|ing)?|green|pasan|pasaron|fallan|fallaron|superad[oa]s|aprobad[oa]s)${END}`,
);
// The pass or fail verb before the ratio: "Pasan 1/2 de los tests", "passed: 1/10".
const RATIO_BEFORE = new RegExp(String.raw`(?:passed|failed|superad[oa]s|aprobad[oa]s|pasan?|fallan?)\s*:?\s*$`);

function directlyNegated(s: string): boolean {
  if (DIRECT_NEGATION.some((re) => re.test(s))) return true;
  for (const m of s.matchAll(BARE_FAIL)) {
    if (TESTS_COUNTED.test(s.slice(0, m.index)) && FAIL_TAIL.test(s.slice(m.index + m[0].length))) return true;
  }
  for (const m of s.matchAll(RATIO)) {
    if (Number(m[1]) >= Number(m[2])) continue;
    if (RATIO_AFTER.test(s.slice(m.index + m[0].length)) || RATIO_BEFORE.test(s.slice(0, m.index))) return true;
  }
  return false;
}

const suiteIn = (s: string): boolean => SUITE.some((re) => re.test(s)) || (TEST_CONTEXT.test(s) && SUITE_IN_CONTEXT.some((re) => re.test(s)));
const countIn = (s: string): boolean => COUNT_ONLY.some((re) => re.test(s));

/** The strict canonical form, on its own line, unquoted, with no heading before it. */
function canonical(u: Unit): boolean {
  if (!u.alone || u.afterHeading || u.quoted) return false;
  if (u.text !== u.plain.trim() || /[()[\]—–"«»]|\s-\s/.test(u.text)) return false;
  const t = u.text.toLowerCase().replace(/\s+/g, ' ').trim();
  return CANONICAL.some((re) => re.test(t));
}

/**
 * The canonical claim of added tests: the whole sentence, alone on its line, after no heading, plain (no
 * parentheses, dashes or quotes), first person and past or perfect: "I added a regression test.", "I've
 * added…", "We wrote…", "He añadido un test de regresión.", "Añadí…".
 */
const ADDED_CANONICAL = [
  /^(?:i|we)(?:\s+have|'ve|’ve)?\s+(?:added|written|wrote|created|introduced)\s+[^.!?]*[.!]$/,
  /^(?:he|hemos)\s+(?:añadido|agregado|escrito|creado|incorporado)\s+[^.!?]*[.!]$/,
  /^(?:añad[íi]|añadimos|agregu[ée]|agregamos|escrib[íi]|escribimos|cre[ée]|creamos|incorpor[ée]|incorporamos)\s+[^.!?]*[.!]$/,
];
const CANONICAL_QUALIFIER = new RegExp(
  String.raw`\bnot\b|n't\b|\bno\b|\bnone\b|\bnor\b|\bnever\b|\bwithout\b|\bexcept\b|\bbut\b|\balthough\b|\bthough\b|\bonly\b|\bpartly\b|\bpartially\b|\bmaybe\b|\bperhaps\b|\bthink\b|\bunless\b|\buntil\b|` +
    String.raw`\bsin${END}|\bnunca${END}|\bning[uú]n|\bsalvo${END}|\bexcepto${END}|\bpero${END}|\baunque${END}|\bsolo${END}|\bs[oó]lo${END}|\bparcialmente${END}|\bquiz[aá]s?${END}|\btal\s+vez${END}|\bcreo${END}`,
);
function addedCanonical(u: Unit): boolean {
  if (!u.alone || u.afterHeading || u.quoted) return false;
  if (u.text !== u.plain.trim() || /[()[\]—–"«»,;:]|\s-\s/.test(u.text)) return false;
  const t = u.text.toLowerCase().replace(/\s+/g, ' ').trim();
  // Nothing that qualifies it: a negation (of anything), an exception, a contrast, a doubt.
  if (CANONICAL_QUALIFIER.test(t)) return false;
  return ADDED_CANONICAL.some((re) => re.test(t));
}
/**
 * A direct negation of adding tests, in the claim's own sentence: the one way to have no claim. The
 * negation is attached to the adding verb or to the tests it adds ("did not add", "no tests were
 * added", "without adding a test"); one about anything else ("without changing the API", "none of the
 * docs changed") leaves the claim, possible.
 */
const ADD_VERB = String.raw`(?:add|adds|added|adding|write|writes|wrote|written|writing|create|creates|created|creating|introduce|introduces|introduced|introducing)\b`;
const ADD_VERB_ES = String.raw`(?:a[ñn]ad[íi]|a[ñn]adimos|agregu[ée]|agregamos|escrib[íi]|escribimos|cre[ée]|creamos|incorpor[ée]|incorporamos|a[ñn]adido|agregado|escrito|creado|incorporado)${END}`;
const TESTS_NOUN = String.raw`(?:(?:new|any|a|regression|unit|extra|more)\s+)*(?:tests?|specs?)\b`;
const PRUEBAS = String.raw`(?:tests?|pruebas?)${END}`;
const ADDED_NEGATED = new RegExp(
  String.raw`(?:\bcannot|\bcan[’']t|\bwon[’']t|\b(?:did|do|does|have|has|had|could|would|will|was|were|is|are)(?:\s+not|n[’']t))\s+(?:yet\s+|been\s+|able\s+to\s+)?${ADD_VERB}|` +
    String.raw`\bnever\s+${ADD_VERB}|\bunable\s+to\s+${ADD_VERB}|\bwithout\s+${ADD_VERB}\s+${TESTS_NOUN}|` +
    String.raw`\b(?:added|wrote|written|created|introduced)\s+no\s+${TESTS_NOUN}|\bno\s+${TESTS_NOUN}\s+(?:(?:were|was|have\s+been|has\s+been|got)\s+)?(?:added|written|created|introduced)\b|` +
    String.raw`\bno\s+(?:(?:he|hemos|ha|han|se\s+ha|se\s+han)\s+)?${ADD_VERB_ES}|\bnunca\s+(?:(?:he|hemos)\s+)?${ADD_VERB_ES}|` +
    String.raw`\bsin\s+(?:a[ñn]adir|agregar|escribir|crear|incorporar)\s+(?:(?:ning[uú]n|un|una|nuevos?|nuevas?|los|las)\s+)?${PRUEBAS}|` +
    String.raw`\bning[uú]n(?:a|o)?\s+${PRUEBAS}(?:\s+de\s+regresi[oó]n)?\s+(?:a[ñn]adid|agregad|nuev)`,
);

/** Plain statements for tests-added and regression claims (not quoted, negated or qualified). */
function plainStatement(u: Unit, s: string): boolean {
  if (u.quoted || NEGATION.test(s) || TEMPORAL.test(s) || HEDGE.test(s) || NOT_ASSERTED.test(s)) return false;
  if (u.heading) {
    const h = lower(u.heading);
    if (TEMPORAL.test(h) || HEDGE.test(h) || NOT_ASSERTED.test(h) || NEGATION.test(h)) return false;
  }
  return true;
}

/**
 * Monotonic by design: adding text to a message can only lower a claim's
 * certainty (certain → possible), never remove it. Only a direct negation of
 * the predicate in the claim's own sentence, or a question, leaves a sentence
 * without a claim. An explicit disclosure about the tests makes the claim
 * `disclosed` (TG006 reports it as INFO for what it discloses).
 */
export function extractClaims(message: string): ExtractedClaim[] {
  const all = units(message);
  const lowered = all.map((u) => lower(u.text));
  const mentionsTests = lowered.some((s) => TEST_CONTEXT.test(s));
  // A condition, a quotation, an example or a time other than now, anywhere in the message.
  const marked = MESSAGE_MARKERS.test(lower(message)) || TEMPORAL.test(lower(message)) || QUOTE_MARKS.test(message);
  // An explicit disclosure about the tests: "not rerun", "did not execute them after…", "no los ejecuté después…".
  const disclosed = lowered.some(
    (s, i) => !all[i]!.bridge && (EXEMPTION_TESTS.test(s) || DISCLOSURE.test(s) || (EXEMPTION.test(s) && (TEST_CONTEXT.test(s) || PASS_WORD.test(s) || (PRONOUN.test(s) && mentionsTests)))),
  );
  const out: ExtractedClaim[] = [];
  const add = (claim: ExtractedClaim): void => {
    if (!out.some((c) => c.kind === claim.kind)) out.push(claim);
  };
  // The strongest sentence of its kind: a certain one over a possible one.
  const addAdded = (claim: ExtractedClaim): void => {
    const at = out.findIndex((c) => c.kind === claim.kind);
    if (at === -1) out.push(claim);
    else if (out[at]!.certainty !== 'certain' && claim.certainty === 'certain') out[at] = claim;
  };
  const candidates: { index: number; canonical: boolean }[] = [];
  all.forEach((u, i) => {
    const s = lowered[i]!;
    if (s.trimEnd().endsWith('?')) return; // a question asserts nothing
    if ((suiteIn(s) || suiteIn(lower(u.plain)) || countIn(s)) && !directlyNegated(s)) candidates.push({ index: i, canonical: canonical(u) });
    // Claims of added tests (TG007). Never dropped but for a question (above) or a direct negation in the
    // sentence; certain only in the canonical form — first person, past or perfect, alone, plain, in a message
    // with no condition, quote, example or time marker; anything else (a modal, a plan, a heading, a bare
    // participle…) is possible.
    const regression = REGRESSION_NOUN.test(s) && REGRESSION_VERB.test(s.replace(REGRESSION_NOUN, ' '));
    const added = TESTS_ADDED.some((re) => re.test(s));
    if ((regression || added) && !ADDED_NEGATED.test(s)) {
      const certainty: ClaimCertainty = !marked && plainStatement(u, s) && addedCanonical(u) ? 'certain' : 'possible';
      if (regression) addAdded({ kind: 'regression_test_added', text: u.text, certainty });
      if (added) addAdded({ kind: 'tests_added', text: u.text, certainty });
    }
  });
  // The strongest claim in the message: a canonical one if there is any.
  const pick = candidates.find((c) => c.canonical) ?? candidates[0];
  if (pick) {
    // Another sentence saying tests fail now leaves the claim in doubt.
    const past = (i: number): boolean => TEMPORAL.test(lowered[i]!) || (all[i]!.heading !== null && TEMPORAL.test(lower(all[i]!.heading!)));
    const contradicted = lowered.some((s, i) => i !== pick.index && FAILING_NOW.test(s) && !past(i));
    const certainty: ClaimCertainty = disclosed ? 'disclosed' : pick.canonical && !marked && !contradicted ? 'certain' : 'possible';
    add({ kind: 'suite_passed', text: all[pick.index]!.text, certainty });
  }
  const order: ClaimKind[] = ['suite_passed', 'tests_added', 'regression_test_added'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
