// The skip/focus vocabulary: one definition, by language and by the form each member takes.
//
// Everything that recognises the vocabulary derives from here, never from a list of its own: the
// extractor's tables (src/parse/ts.ts, py.ts, py-binding.ts), the marker net's patterns
// (src/rules/net.ts), the contagion net's tokens (src/rules/contagion.ts), the table of docs/rules.md
// (rendered by `renderVocabulary`, compared by test/vocabulary.test.ts) and the vocabulary axis of the
// best-effort matrix (test/silence-guarantee.test.ts). test/vocabulary.test.ts checks that every
// member, in each language, is a token of the contagion net and marks what is bound to it.
import type { MarkerKind } from './types.js';
import { nameTable } from '../util/names.js';

// --- JavaScript / TypeScript ---------------------------------------------------------------------

/** The functions that declare a test (`it(…)`, `test(…)`, `specify(…)`). */
export const JS_TEST_ROOTS: ReadonlySet<string> = new Set(['it', 'test', 'specify']);

/** Functions that are a marker by themselves (`fit(…)`, `xdescribe(…)`); `suite`: they declare a suite. */
export const JS_ROOT_MARKERS: Readonly<Record<string, { kind: MarkerKind; suite: boolean }>> = nameTable('ROOT_MARKERS', {
  fit: { kind: 'only', suite: false },
  fdescribe: { kind: 'only', suite: true },
  xit: { kind: 'skip', suite: false },
  xtest: { kind: 'skip', suite: false },
  xspecify: { kind: 'skip', suite: false },
  xdescribe: { kind: 'skip', suite: true },
  xcontext: { kind: 'skip', suite: true },
});

/**
 * Modifiers (`it.only`, `test.fixme`) → marker kind, and whether the test still runs with a checked outcome.
 * `testRootOnly`: the census and the marker net count `x.<name>` only on a test root (`it.fail`, `test.fail`),
 * where any other receiver is common outside the vocabulary (`assert.fail`); the extractor and the contagion
 * net read it everywhere else as any other member.
 */
export const JS_SEGMENT_MARKERS: Readonly<Record<string, { kind: MarkerKind; checked: boolean; testRootOnly?: true }>> = nameTable('SEGMENT_MARKERS', {
  only: { kind: 'only', checked: true },
  skip: { kind: 'skip', checked: false },
  todo: { kind: 'todo', checked: false },
  fixme: { kind: 'fixme', checked: false },
  fails: { kind: 'xfail', checked: true }, // vitest: must fail
  failing: { kind: 'xfail', checked: true }, // jest: must fail
  fail: { kind: 'xfail', checked: true, testRootOnly: true }, // playwright: must fail
});

/** `skipIf(c)` skips when c holds; `runIf(c)` skips when c does not. */
export const JS_CONDITIONAL_SEGMENTS: Readonly<Record<string, { kind: MarkerKind; negated: boolean }>> = nameTable('CONDITIONAL_SEGMENTS', {
  skipIf: { kind: 'skip', negated: false },
  runIf: { kind: 'skip', negated: true },
});

/**
 * Members of the vocabulary that only a test's context has, not a test root (`t.runOnly(true)` in node:test: only
 * the subtests with `only` run, with `--test-only`). The context's `skip`/`todo` are the modifiers' names already.
 */
export const JS_CONTEXT_MARKERS: Readonly<Record<string, { kind: MarkerKind; checked: boolean }>> = nameTable('CONTEXT_MARKERS', {
  runOnly: { kind: 'only', checked: true },
});

/** `{ skip: true }`, `{ only: cond }`, `{ todo }` in a test's options object. */
export const JS_OPTION_MARKERS: Readonly<Record<string, { kind: MarkerKind; checked: boolean }>> = nameTable('OPTION_MARKERS', {
  skip: { kind: 'skip', checked: false },
  only: { kind: 'only', checked: true },
  todo: { kind: 'todo', checked: false },
  fails: { kind: 'xfail', checked: true },
});

// --- Python ----------------------------------------------------------------------------------------

/** `pytest.mark.<name>`. */
export const PY_MARK_KINDS: Readonly<Record<string, MarkerKind>> = nameTable('MARK_KINDS', { skip: 'skip', skipif: 'skip', xfail: 'xfail', only: 'only', focus: 'only' });
/**
 * Members whose effect the base runner does not guarantee: a pytest mark only a plugin gives an effect (without it
 * pytest runs the test, with an unknown-mark warning). Never a FAIL (docs/rules.md, TG002); the value names the plugin.
 * JS members that need a flag are in the runners' API (src/parse/ts-binding.ts, `focusNeedsFlag`).
 */
export const PY_PLUGIN_MARKS: Readonly<Record<string, string>> = nameTable('PLUGIN_MARKS', { only: 'a plugin such as pytest-only', focus: 'a plugin' });
/** `unittest.<name>` decorators, `@<name>` when imported. */
export const PY_UNITTEST_DECORATORS: Readonly<Record<string, MarkerKind>> = nameTable('UNITTEST_DECORATORS', { skip: 'skip', skipIf: 'skip', skipUnless: 'skip', expectedFailure: 'xfail' });
/** Exceptions that skip when raised (`raise unittest.SkipTest`): they do nothing until raised. */
export const PY_UNITTEST_EXCEPTIONS: Readonly<Record<string, MarkerKind>> = nameTable('UNITTEST_EXCEPTIONS', { SkipTest: 'skip' });
/** `unittest.<name>`: the decorators and the exceptions. */
export const PY_UNITTEST_KINDS: Readonly<Record<string, MarkerKind>> = nameTable('UNITTEST_KINDS', { ...PY_UNITTEST_DECORATORS, ...PY_UNITTEST_EXCEPTIONS });
/** `pytest.<name>(…)`. */
export const PY_PYTEST_CALL_KINDS: Readonly<Record<string, MarkerKind>> = nameTable('PYTEST_CALL_KINDS', { skip: 'skip', xfail: 'xfail', importorskip: 'skip' });
/** `self.<name>(…)` in a `unittest.TestCase`. */
export const PY_TESTCASE_METHODS: Readonly<Record<string, MarkerKind>> = nameTable('TESTCASE_METHODS', { skipTest: 'skip' });

// --- the tokens: every name above ---------------------------------------------------------------

/** Every member of tables whose values are a kind or carry one, by name; a name with two kinds is an error. */
function tokens(id: string, tables: ReadonlyArray<Readonly<Record<string, MarkerKind | { kind: MarkerKind }>>>): Readonly<Record<string, MarkerKind>> {
  const out = new Map<string, MarkerKind>();
  for (const table of tables) {
    for (const [name, v] of Object.entries(table)) {
      const kind = typeof v === 'string' ? v : v.kind;
      const before = out.get(name);
      if (before !== undefined && before !== kind) throw new Error(`vocabulary: ${name} names both ${before} and ${kind}`);
      out.set(name, kind);
    }
  }
  return nameTable(id, Object.fromEntries(out));
}

/** The names of the vocabulary in JavaScript/TypeScript, and the kind of marker each names. */
export const JS_TOKENS = tokens('TS_TOKENS', [JS_ROOT_MARKERS, JS_SEGMENT_MARKERS, JS_CONDITIONAL_SEGMENTS, JS_CONTEXT_MARKERS, JS_OPTION_MARKERS]);
/** The names of the vocabulary in Python (pytest and unittest), and the kind of marker each names. */
export const PY_TOKENS = tokens('PY_TOKENS', [PY_MARK_KINDS, PY_UNITTEST_KINDS, PY_PYTEST_CALL_KINDS, PY_TESTCASE_METHODS]);

// --- the forms, as docs/rules.md lists them ------------------------------------------------------

/** How each member is written, by language and kind: what the marker net counts and docs/rules.md lists. */
export interface VocabularyForm {
  lang: 'js' | 'python';
  kind: MarkerKind;
  /** The shape: `.name`, `name(`, `name: true`, `mark.name`… */
  shape: 'member' | 'test-root-member' | 'root-call' | 'option' | 'mark' | 'pytest-call' | 'method-call' | 'raise' | 'unittest' | 'decorator';
  names: string[];
}

const KINDS: readonly MarkerKind[] = ['skip', 'only', 'todo', 'fixme', 'xfail'];

function byKind(tables: ReadonlyArray<Readonly<Record<string, MarkerKind | { kind: MarkerKind }>>>, keep: (name: string) => boolean = () => true): Map<MarkerKind, string[]> {
  const out = new Map<MarkerKind, string[]>();
  for (const [name, v] of tables.flatMap((t) => Object.entries(t))) {
    if (!keep(name)) continue;
    const kind = typeof v === 'string' ? v : v.kind;
    out.set(kind, [...(out.get(kind) ?? []), name]);
  }
  return out;
}

/** Every form of the vocabulary, by language, kind and shape (the members grouped). */
export function vocabularyForms(): VocabularyForm[] {
  const out: VocabularyForm[] = [];
  const add = (lang: VocabularyForm['lang'], shape: VocabularyForm['shape'], groups: Map<MarkerKind, string[]>): void => {
    for (const kind of KINDS) {
      const names = groups.get(kind);
      if (names && names.length > 0) out.push({ lang, kind, shape, names });
    }
  };
  const testRootOnly = (n: string): boolean => JS_SEGMENT_MARKERS[n]?.testRootOnly === true;
  add('js', 'member', byKind([JS_SEGMENT_MARKERS, JS_CONDITIONAL_SEGMENTS, JS_CONTEXT_MARKERS], (n) => !testRootOnly(n)));
  add('js', 'test-root-member', byKind([JS_SEGMENT_MARKERS], testRootOnly));
  add('js', 'root-call', byKind([JS_ROOT_MARKERS]));
  add('js', 'option', byKind([JS_OPTION_MARKERS]));
  add('python', 'mark', byKind([PY_MARK_KINDS]));
  add('python', 'pytest-call', byKind([PY_PYTEST_CALL_KINDS]));
  add('python', 'method-call', byKind([PY_TESTCASE_METHODS]));
  add('python', 'raise', byKind([PY_UNITTEST_EXCEPTIONS]));
  add('python', 'unittest', byKind([PY_UNITTEST_DECORATORS]));
  add('python', 'decorator', byKind([PY_UNITTEST_DECORATORS]));
  return out;
}

const RENDER: Record<VocabularyForm['shape'], (names: string[]) => string> = {
  member: (ns) => ns.map((n) => `\`.${n}\``).join(', '),
  'test-root-member': (ns) => ns.map((n) => [...JS_TEST_ROOTS].map((r) => `\`${r}.${n}\``).join('/')).join(', '),
  'root-call': (ns) => ns.map((n) => `\`${n}(\``).join(', '),
  option: (ns) => ns.map((n) => `\`${n}: true\``).join(', '),
  mark: (ns) => ns.map((n) => `\`mark.${n}\``).join(', '),
  'pytest-call': (ns) => ns.map((n) => `\`pytest.${n}(\``).join(', '),
  'method-call': (ns) => ns.map((n) => `\`.${n}(\``).join(', '),
  raise: (ns) => ns.map((n) => `\`raise … ${n}\``).join(', '),
  unittest: (ns) => `\`unittest.${ns.join('/')}\``,
  decorator: (ns) => `\`${ns.map((n) => `@${n}`).join('/')}\``,
};

/** The vocabulary table of docs/rules.md (*Safety nets*), between its markers. */
export function renderVocabulary(): string {
  const forms = vocabularyForms();
  const cell = (lang: VocabularyForm['lang'], kind: MarkerKind): string =>
    forms.filter((f) => f.lang === lang && f.kind === kind).map((f) => RENDER[f.shape](f.names)).join(', ') || '—';
  return ['| Kind | JS/TS | Python |', '|---|---|---|', ...KINDS.map((k) => `| ${k} | ${cell('js', k)} | ${cell('python', k)} |`)].join('\n');
}
