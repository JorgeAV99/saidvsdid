export type LanguageId = 'typescript' | 'tsx' | 'python';

/** How a test was focused (`only`) or taken out of the run (everything else). */
export type MarkerKind = 'only' | 'skip' | 'todo' | 'fixme' | 'xfail';

/**
 * - `unconditional`: always applies (`it.skip`, `@pytest.mark.skip`).
 * - `environment`: conditional on platform/runtime/env (`skipIf(process.platform === 'win32')`,
 *   `skipif(sys.platform == "win32")`, `importorskip`). Usually legitimate.
 * - `conditional`: conditional on something we cannot classify.
 */
export type MarkerCondition = 'unconditional' | 'environment' | 'conditional';

/**
 * Whether a name in the code is certainly the runner's API (docs/rules.md, *Attribution: the
 * runner's API by binding*), under the documented assumption that the framework is not patched at
 * run time. `certain`: a static import of a runner (JS/TS), a module-level import of pytest/unittest
 * that nothing in the module rebinds, `self.<method>` inherited from unittest.TestCase (Python). Anything
 * else is `uncertain`, with the reason the rules quote in their WARN ("may …"): never a FAIL.
 */
export type Binding = { certain: true; via?: 'global' } | { certain: false; why: string };

export const CERTAIN: Binding = { certain: true };
/**
 * Certain through Jest's globals, which a certified invocation and configuration inject (src/config/jest-globals.ts):
 * TG002 and TG003 accept it; TG001's escalation does not (docs/rules.md, *Jest's globals*).
 */
export const GLOBAL: Binding = { certain: true, via: 'global' };
export const uncertain = (why: string): Binding => ({ certain: false, why });
/** The less certain of two bindings (the first reason wins); of two certain ones, a global provenance from either side. */
export const weakest = (a: Binding, b: Binding): Binding => {
  if (!a.certain) return a;
  if (!b.certain) return b;
  return a.via === 'global' || b.via === 'global' ? GLOBAL : a;
};

import type { MarkerEffect } from '../rules/effects.js';

/**
 * Whether a marker, or a test's declaration, is written in a canonical form (docs/rules.md, *Verdicts*): a whitelist of
 * exact syntactic patterns, the only forms a FAIL is promised for — F1 the decorators of a Python test, F2 a call that is
 * the first statement of the test's body with an allowed signature, F3 a JS declaration that is a statement of the file
 * or of a canonical describe's callback with the runner's documented arguments, F4 options, F5 a mark's arguments, F7 a
 * Python test the file shows collected. Anything that does not match exactly is a WARN that says why ("may …").
 */
export type MarkerForm = { canonical: true } | { canonical: false; why: string };
export const CANONICAL: MarkerForm = { canonical: true };
export const notCanonical = (why: string): MarkerForm => ({ canonical: false, why });
/** The first form that is not canonical (its reason), or canonical. */
export const firstNotCanonical = (...forms: MarkerForm[]): MarkerForm => forms.find((f) => !f.canonical) ?? CANONICAL;

export interface Marker {
  kind: MarkerKind;
  condition: MarkerCondition;
  /** 1-based line where the marker is written. */
  line: number;
  /**
   * Structural identity of the marker in its file: the chain of enclosing
   * suites/tests/functions by name plus an ordinal, e.g.
   * `suite:"login"/test:"shows the form"/test.skip#0`. Stable across
   * reformatting and line shifts; two markers on one line stay distinct.
   */
  site: string;
  /** Short source snippet identifying the marker, e.g. `it.only` or `@pytest.mark.skip`. */
  text: string;
  /** Where the marker is attached; inherited markers keep the scope of their origin. */
  scope: 'test' | 'suite' | 'file';
  /**
   * The test still runs and an unexpected outcome still fails the suite:
   * strict expected-failures (`it.fails`, jest `failing`, Playwright `fail`,
   * `xfail(strict=True)`, `unittest.expectedFailure`). False for skip / todo /
   * fixme, non-strict `xfail` (an XPASS passes) and imperative `pytest.xfail()`.
   * Always true for `only`.
   */
  checked: boolean;
  /**
   * What the marker does to the tests when its runner guarantees it (src/rules/effects.ts: `not-run`,
   * `expected-failure`), or why it gives no FAIL: a runner that is not certain, a member it guarantees no effect of, an
   * argument that restricts it (`xfail(raises=…)`), `unittest.expectedFailure` off a `TestCase` method.
   */
  effect: MarkerEffect;
  /** Whether it is written in a canonical form (MarkerForm). */
  form: MarkerForm;
  /** The marker's own callee and every declaration or hook around it (see Binding). */
  binding: Binding;
}

export interface TestCase {
  /**
   * Stable, human-readable identity within the file.
   * TS/JS: describe chain joined with " > ". Python: pytest-style `Class::test_name`.
   */
  name: string;
  /**
   * The test's ordinal among the file's tests with the same name (src/rules/ids.ts): 1, 2… in declaration order; its
   * identity is (file, name, ordinal). A file that repeats a full name makes its tests' markers a WARN.
   */
  ordinal: number;
  /**
   * Whether the test is declared in a canonical form (docs/rules.md, *Verdicts*): JS, F3 for its declaration and every
   * describe around it; Python, F7 (a test the file shows the runner collects: bound once, its decorators F1, …).
   */
  declaration: MarkerForm;
  /** 1-based line of the test declaration. */
  line: number;
  /** Whitespace-normalised source of the test body ('' for `it.todo('x')`). */
  body: string;
  /**
   * The test's parameter tables, whitespace-normalised: `.each(...)`/`.for(...)`
   * arguments of the test and its suites, `@pytest.mark.parametrize(...)` of the
   * test and its classes. '' when the test is not parametrised. Adding a row
   * changes this, not the body.
   */
  params: string;
  /** Number of assertion sites found in the body (`assertionSites.length`). */
  assertions: number;
  /** Recognised assertions in the body, in source order (see Assertion). */
  assertionSites: Assertion[];
  /**
   * Functions called from the body that may assert on the test's behalf:
   * same-file helpers that (transitively) assert or call something unknown,
   * helpers imported from test-support modules, assertion-like names
   * (`expectX`, `checkX`, `verifyX`), unresolved globals, `self.helper()`.
   * Production code imported from elsewhere and language builtins are not.
   */
  helperCalls: string[];
  /** Effective markers: the test's own plus those inherited from suites and file. */
  markers: Marker[];
  /**
   * pytest: names of every mark on the test, its classes and the module
   * (`parametrize`, `slow`, ...), which `-k` also matches. [] for JS/TS.
   */
  marks: string[];
  /**
   * Its declaration and every suite around it are the runner's (JS/TS: a static import; a test
   * declared inside a helper function is uncertain). Python tests are collected by name: certain.
   */
  binding: Binding;
}

/**
 * A timeout or retry setting written in a test file: `it('x', fn, 30000)`,
 * `{ timeout, retry }` test options, `jest.setTimeout(n)`,
 * `vi.setConfig({ testTimeout })`, `test.setTimeout(n)`, `test.slow()`,
 * `jest.retryTimes(n)`, `test.describe.configure({ retries })`,
 * `@pytest.mark.timeout(n)`, `@pytest.mark.flaky(reruns=n)`.
 */
export interface Knob {
  /** `options`: test options passed through a variable (`it('x', opts, fn)`), which may hold either. */
  kind: 'timeout' | 'retry' | 'options';
  /**
   * Milliseconds (JS) or seconds (pytest-timeout) for timeouts, extra attempts
   * for retries; null when not a literal. `test.slow()` has no value.
   */
  value: number | null;
  /** How it was written: `arg`, `options`, `jest.setTimeout`, `mark.timeout`, ... */
  form: string;
  line: number;
  text: string;
  /** Full name of the test it applies to; null for suite- or file-level settings. */
  test: string | null;
  /** Identity of a suite/file-level setting across base and head (enclosing structure + form). */
  key: string;
}

/**
 * One assertion site: `expect(x).toEqual(y)`, `assert.equal(a, b)`,
 * `expect.assertions(2)`, `assert x == y`, `self.assertEqual(a, b)`,
 * `pytest.raises(E)`, `mock.assert_called_with(...)`.
 */
export interface Assertion {
  line: number;
  /** Whitespace-normalised source, used to follow an assertion across tests. */
  text: string;
  /**
   * What is being asserted on, whitespace-normalised: the argument of
   * `expect(...)`, the first argument of `assertX(...)`, the left operand of
   * `assert a == b`, the mock of `m.assert_called_with()`. Null when there is
   * no subject (`expect.assertions(n)`, `pytest.raises`).
   */
  subject: string | null;
  /**
   * The matcher, normalised: `toEqual`, `not.toBeNull`, `toThrow()` vs
   * `toThrow(arg)`, `assertEqual`, `==`, `is not None`, `truthy`.
   */
  matcher: string;
  /** Whether its root (`expect`, `assert`, `self.assertEqual`, `pytest.raises`) is certainly the runner's or an assertion library's. */
  binding: Binding;
  /** `pytest.approx` tolerances on the right-hand side, when given literally. */
  approx?: { rel: number | null; abs: number | null };
}

/**
 * Every syntactic occurrence of a skip/focus marker in a file, attributed or
 * not. Used to enforce the invariant that a diff adding a marker anywhere in a
 * test file never passes.
 */
export interface MarkerSite {
  site: string;
  kind: MarkerKind;
  line: number;
  text: string;
  /**
   * True when the marker sits where it certainly applies: directly in a test
   * body, a describe body, an inline hook of that block, or the file top level.
   * Markers in helpers, callbacks, methods or nested functions are not.
   */
  attributed: boolean;
}

/**
 * Whether the language's own tooling read the file's names (Python's `ast`/`symtable`, the
 * TypeScript compiler): when it did not (no interpreter, an unsupported version, a file it rejects),
 * nothing in the file is certainly the runner's, and the file gets one WARN.
 */
export type ScopeReading = { known: true } | { known: false; why: string };

export interface TestFile {
  path: string;
  language: LanguageId;
  tests: TestCase[];
  markerSites: MarkerSite[];
  /** Timeout and retry settings (TG005). */
  knobs: Knob[];
  /** The file imports `@playwright/test` (its default timeout is 30 s, not 5 s). */
  playwright: boolean;
  /** The file imports or requires `node:test`, whose tests have no default timeout (Infinity). */
  nodeTest: boolean;
  /** tree-sitter reported syntax errors; results may be partial. */
  parseErrors: boolean;
  /** Whether the language's tooling read the file's names (see ScopeReading). */
  scopes: ScopeReading;
  /**
   * Set when the file is not analysed at all (a Python file with lone CR line breaks, which Python and
   * the syntax tree read differently): no tests, no markers; the check warns about the file and leaves
   * both sides out of the comparison. Null for every analysed file.
   */
  notAnalysed: { reason: 'lone_cr'; why: string } | null;
}

/**
 * F6 (docs/rules.md, *Verdicts*): one effect per test, over every marker written for it — the ones that apply and the
 * ones whose literal condition never applies (`skipIf(False)`, `{ fails: false }`), evaluated before they are set aside
 * (`inert`), `only` included. With any other one, an expected failure is not canonical: which takes effect is the
 * runner's.
 */
export function oneEffect(markers: readonly Marker[], inert: readonly string[]): Marker[] {
  if (markers.length + inert.length <= 1) return [...markers];
  return markers.map((m) => {
    if (!m.form.canonical || !m.effect.known || m.effect.effect !== 'expected-failure') return m;
    const other = markers.find((o) => o !== m && o.site !== m.site)?.text ?? inert[0];
    if (other === undefined) return m;
    return { ...m, form: notCanonical(`\`${other}\` is also written for the test, and the runner decides which of the two takes effect (one effect per test)`) };
  });
}
