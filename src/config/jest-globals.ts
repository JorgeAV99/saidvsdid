// When Jest's globals are Jest's (docs/rules.md, *Jest's globals*): Jest injects `it`, `test`, `describe`, `fit`, `xit`…
// into every test file it runs, unless `injectGlobals: false`, so a global `it.skip(…)` is Jest's — if Jest is what runs
// the file, with its standard runner, runtime and environment. That is certain only inside a closed grammar of the
// invocation and the configuration, read from the trees of the diff; anything else leaves the globals uncertain (WARN):
//
// - the package of the file (the nearest directory above it with a package.json: npm runs its scripts there) has a
//   `test` script that is exactly `[npx ]jest` and flags from a closed list (no positional argument, no environment, no
//   launcher, no operator), and no `pretest`/`posttest` (npm runs them before and after);
// - its configuration is Jest's own resolution from that directory: none (Jest's defaults), or exactly one of
//   `jest.config.json` or a `jest` key in that package.json (a `jest.config.{js,ts,mjs,cjs,cts,mts}` is never evaluated),
//   JSON with no duplicate key, every key from an allowlist that cannot change which function `it` is, with
//   `injectGlobals` only `true`, `testEnvironment` only a standard one and `bail` only absent, 0 or false.
//
// The rule that reads it (src/check.ts) also requires both sides of the file certified with the same invocation and
// configuration, and no `@jest-environment` docblock in the file.
import { parseJsonValue } from './json.js';
import { shellWords, type ConfigValue } from './values.js';

export type JestGlobals = { certified: true; key: string } | { certified: false; why: string };

/** Flags of `jest` that change neither the globals, the runner, the environment, the runtime nor the configuration. */
const FLAGS: ReadonlySet<string> = new Set(['--ci', '--coverage', '--runInBand', '-i', '--verbose', '--silent', '--passWithNoTests', '--detectOpenHandles', '--forceExit', '--colors', '--no-cache', '--watchAll=false']);

/** Configuration keys whose values cannot change which function a global `it` is (each checked further below when listed there). */
const KEYS: ReadonlySet<string> = new Set([
  'testMatch',
  'testRegex',
  'testPathIgnorePatterns',
  'roots',
  'rootDir',
  'testTimeout',
  'verbose',
  'bail',
  'clearMocks',
  'resetMocks',
  'restoreMocks',
  'collectCoverage',
  'collectCoverageFrom',
  'coverageDirectory',
  'coveragePathIgnorePatterns',
  'coverageProvider',
  'coverageReporters',
  'coverageThreshold',
  'testEnvironment',
  'injectGlobals',
  'moduleFileExtensions',
  'modulePathIgnorePatterns',
  'moduleNameMapper',
  'moduleDirectories',
  'testURL',
  'errorOnDeprecated',
  'displayName',
  'transformIgnorePatterns',
]);

/** The environments Jest ships (a custom one can define anything). */
const ENVIRONMENTS: ReadonlySet<string> = new Set(['node', 'jsdom', 'jest-environment-node', 'jest-environment-jsdom']);

const JS_CONFIGS = ['js', 'ts', 'mjs', 'cjs', 'cts', 'mts'].map((e) => `jest.config.${e}`);

const join = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);

/** A JSON object's members as a table with no prototype, or why it is not one (duplicates included). */
function objectOf(text: string, what: string): { props: Map<string, ConfigValue> } | { why: string } {
  const duplicates: string[] = [];
  const v = parseJsonValue(text, (k) => duplicates.push(k));
  if (duplicates.length > 0) return { why: `${what} repeats the key ${JSON.stringify(duplicates[0])}` };
  if (!v || v.t !== 'obj' || v.open) return { why: `${what} is not a JSON object` };
  return { props: v.props };
}

/** The literal's JSON text, for comparing two sides (every value here is a JSON literal). */
function text(v: ConfigValue): string {
  switch (v.t) {
    case 'str':
      return JSON.stringify(v.v);
    case 'num':
      return String(v.v);
    case 'bool':
      return String(v.v);
    case 'null':
      return 'null';
    case 'arr':
      return `[${v.items.map(text).join(',')}]`;
    case 'obj':
      return `{${[...v.props].map(([k, x]) => `${JSON.stringify(k)}:${text(x)}`).join(',')}}`;
    default:
      return '?';
  }
}

/** Why a configuration object leaves the globals uncertain, or null. */
function configDoubt(props: Map<string, ConfigValue>, where: string): string | null {
  for (const [key, value] of props) {
    if (!KEYS.has(key)) return `${where} sets \`${key}\`, which saidvsdid does not read as harmless to the globals`;
    if (key === 'injectGlobals' && !(value.t === 'bool' && value.v === true)) return `${where} sets \`injectGlobals\` to ${text(value)}`;
    if (key === 'testEnvironment' && !(value.t === 'str' && ENVIRONMENTS.has(value.v))) return `${where} sets \`testEnvironment\` to ${text(value)}, not one of Jest's own`;
    if (key === 'bail' && !((value.t === 'num' && value.v === 0) || (value.t === 'bool' && value.v === false))) return `${where} sets \`bail\` to ${text(value)}: a failure elsewhere can stop Jest before this file`;
  }
  return null;
}

/**
 * Whether Jest's globals are certainly Jest's in `path` on one side of the diff (`read`: a file of that side, or null).
 * `key` identifies the invocation and configuration, so that the caller can require the same on both sides.
 */
export function jestGlobalsFor(path: string, read: (p: string) => string | null, files: readonly string[] | null): JestGlobals {
  if (files === null) return { certified: false, why: "the repository's files are not listed, so its configuration is not certain" };
  // Names compare without case, as Jest and npm find them on Windows and macOS (`JEST.CONFIG.CJS` is Jest's file there):
  // a file whose name is one of these in another case is never certified.
  const byDir = new Map<string, Map<string, string>>();
  for (const f of files) {
    const at = f.lastIndexOf('/');
    const d = at === -1 ? '' : f.slice(0, at);
    let names = byDir.get(d);
    if (!names) byDir.set(d, (names = new Map()));
    names.set(f.slice(at + 1).toLowerCase(), f.slice(at + 1));
  }
  /** The file of that name (any case) in a directory: its exact name, or null. */
  const named = (d: string, name: string): string | null => byDir.get(d)?.get(name) ?? null;
  const parts = path.replace(/\\/g, '/').split('/').slice(0, -1);
  let dir: string | null = null;
  let pkgText: string | null = null;
  for (let i = parts.length; i >= 0 && dir === null; i--) {
    const d = parts.slice(0, i).join('/');
    const exact = named(d, 'package.json');
    if (exact === null) continue;
    if (exact !== 'package.json') return { certified: false, why: `${join(d, exact)} is package.json in another case` };
    const t = read(join(d, 'package.json'));
    if (t !== null) {
      dir = d;
      pkgText = t;
    }
  }
  if (dir === null || pkgText === null) return { certified: false, why: 'no package.json above the file runs Jest' };
  const where = join(dir, 'package.json');
  const pkg = objectOf(pkgText, where);
  if ('why' in pkg) return { certified: false, why: pkg.why };
  const scripts = pkg.props.get('scripts');
  if (!scripts || scripts.t !== 'obj' || scripts.open) return { certified: false, why: `${where} has no test script` };
  // A Map: a script's name read from the input is never a prototype's member.
  for (const hook of ['pretest', 'posttest']) if (scripts.props.has(hook)) return { certified: false, why: `${where} has a \`${hook}\` script, which npm runs around jest` };
  const test = scripts.props.get('test');
  if (!test || test.t !== 'str') return { certified: false, why: `${where} has no test script` };
  const words = shellWords(test.v);
  const command = words && words[0] === 'npx' ? words.slice(1) : words;
  // Mocha's BDD interface defines the same names, but its configuration (rc files in JS and YAML, merged with package.json,
  // focus across files, runtime skips) is not read: its globals stay uncertain (docs/rules.md, *Jest's globals*).
  if (command && command.includes('mocha')) return { certified: false, why: "the test script runs mocha, whose globals saidvsdid cannot certify (it does not read Mocha's configuration)" };
  if (!command || command[0] !== 'jest') return { certified: false, why: `the test script (\`${test.v}\`) is not one plain jest invocation` };
  const odd = command.slice(1).find((w) => !FLAGS.has(w));
  if (odd !== undefined) return { certified: false, why: `the test script passes \`${odd}\` to jest, which saidvsdid does not read as harmless to the globals` };

  const js = JS_CONFIGS.map((f) => named(dir!, f)).find((f) => f !== null);
  if (js) return { certified: false, why: `${join(dir, js)} is JavaScript, which saidvsdid never evaluates` };
  const json = named(dir, 'jest.config.json');
  if (json !== null && json !== 'jest.config.json') return { certified: false, why: `${join(dir, json)} is jest.config.json in another case` };
  const jsonText = json === null ? null : read(join(dir, json));
  const inPackage = pkg.props.get('jest');
  if (jsonText !== null && inPackage) return { certified: false, why: `${where} has a \`jest\` key and ${join(dir, 'jest.config.json')} exists (Jest refuses two configurations)` };
  let config = new Map<string, ConfigValue>();
  if (jsonText !== null) {
    const o = objectOf(jsonText, join(dir, 'jest.config.json'));
    if ('why' in o) return { certified: false, why: o.why };
    config = o.props;
  } else if (inPackage) {
    if (inPackage.t !== 'obj' || inPackage.open) return { certified: false, why: `${where}'s \`jest\` key is not an object` };
    config = inPackage.props;
  }
  const doubt = configDoubt(config, jsonText !== null ? join(dir, 'jest.config.json') : `${where}'s \`jest\` key`);
  if (doubt) return { certified: false, why: doubt };
  return { certified: true, key: `${dir}\n${test.v}\n${jsonText !== null ? 'json' : 'package'}\n${text({ t: 'obj', props: config, line: 0, open: false })}` };
}

/** A file's own `@jest-environment` docblock overrides the configured environment: never certified. */
export const JEST_DOCBLOCK = /@jest-environment(?:-options)?\b/;

/**
 * The certification of a test file changed by the pull request: both of its sides (each with its own path) certified
 * with the same invocation and configuration, and no `@jest-environment` docblock on either; a side that does not
 * exist does not count, but at least one must.
 */
export function jestGlobalsOfChange(
  sides: ReadonlyArray<{ path: string; source: string; read: (p: string) => string | null; files: readonly string[] | null }>,
): JestGlobals {
  if (sides.length === 0) return { certified: false, why: 'no side of the file' };
  const each = sides.map((s) => (JEST_DOCBLOCK.test(s.source) ? ({ certified: false, why: `${s.path} names its own environment (\`@jest-environment\`)` } as JestGlobals) : jestGlobalsFor(s.path, s.read, s.files)));
  const failed = each.find((c) => !c.certified);
  if (failed) return failed;
  const keys = new Set(each.map((c) => (c.certified ? c.key : '')));
  if (keys.size > 1) return { certified: false, why: 'the test script or the Jest configuration differs between base and head' };
  return each[0]!;
}
