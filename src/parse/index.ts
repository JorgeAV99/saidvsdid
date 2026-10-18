import { getParser, languageForPath } from './loader.js';
import { extractPyTests } from './py.js';
import { pythonFacts, type PyFacts } from './py-scopes.js';
import { extractTsTests } from './ts.js';
import type { TestFile } from './types.js';

export type { Assertion, Binding, Knob, LanguageId, Marker, MarkerCondition, MarkerKind, MarkerSite, ScopeReading, TestCase, TestFile } from './types.js';
export { analysePython, pythonFacts, pythonRuntime, pythonRuntimeIfStarted, type PyFacts } from './py-scopes.js';
export { languageForPath } from './loader.js';

const TS_TEST_NAME = /(?:^|\/)[^/]+\.(?:test|spec|e2e)\.[cm]?[jt]sx?$/i;
const TS_TEST_DIR = /(?:^|\/)(?:__tests__|__specs__)\//;
const TS_LOOSE_DIR = /(?:^|\/)(?:tests?|specs?|e2e)\//i;
const PY_TEST_NAME = /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/;

/**
 * Whether `path` is a test file by naming convention. Files that only live in
 * a `test/` directory (helpers, fixtures) count only if they declare tests,
 * which the caller checks after parsing (see `isLooseTestPath`).
 */
export function isTestPath(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  if (languageForPath(p) === null) return false;
  return TS_TEST_NAME.test(p) || TS_TEST_DIR.test(p) || PY_TEST_NAME.test(p);
}

export function isLooseTestPath(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return languageForPath(p) !== null && !p.endsWith('.py') && TS_LOOSE_DIR.test(p);
}

export interface ParseOptions {
  /** pytest's `xfail_strict` for this file (see config/pytest.ts); a bare `xfail` inherits it. */
  xfailStrict?: boolean;
  /** The file's bytes (Python reads them itself, PEP 263); absent: `source` encoded as UTF-8. */
  bytes?: Uint8Array;
  /**
   * Python's answer for the file, taken once by the caller: src/check.ts takes a file's base and head together, decides
   * on them (one side unread → both), and the parsing reads exactly that. Absent (a standalone parse: tests, tools):
   * asked here, once.
   */
  pyFacts?: PyFacts;
}

/** A line break Python reads and tree-sitter's grammar does not: a CR not followed by LF. */
const LONE_CR = /\r(?!\n)/;

export async function parseTestFile(path: string, source: string, options: ParseOptions = {}): Promise<TestFile> {
  const language = languageForPath(path);
  if (!language) throw new Error(`unsupported file type: ${path}`);
  if (language === 'python' && LONE_CR.test(source)) {
    // Python reads a lone CR as a new line; tree-sitter's grammar does not, so its tree would not be the
    // file Python runs. Not analysed: an explicit WARN (src/check.ts), never a reading of the wrong tree.
    const why = 'the file breaks lines with a lone CR (\\r), which Python reads as a new line and the syntax tree saidvsdid uses does not';
    return { path, language, tests: [], markerSites: [], knobs: [], playwright: false, nodeTest: false, parseErrors: false, scopes: { known: false, why }, notAnalysed: { reason: 'lone_cr', why } };
  }
  const parser = await getParser(language);
  const tree = parser.parse(source);
  if (!tree) throw new Error(`tree-sitter failed to parse ${path}`);
  try {
    const parseErrors = tree.rootNode.hasError;
    if (language === 'python') {
      const bytes = options.bytes ?? Buffer.from(source, 'utf8');
      const { tests, markerSites, knobs, scopes } = extractPyTests(tree.rootNode, source, options.pyFacts ?? pythonFacts(bytes), options.xfailStrict ?? false);
      return { path, language, tests, markerSites, knobs, playwright: false, nodeTest: false, parseErrors, scopes, notAnalysed: null };
    }
    const { tests, markerSites, knobs, playwright, nodeTest, scopes } = extractTsTests(tree.rootNode, source, path);
    return { path, language, tests, markerSites, knobs, playwright, nodeTest, parseErrors, scopes, notAnalysed: null };
  } finally {
    tree.delete();
  }
}
