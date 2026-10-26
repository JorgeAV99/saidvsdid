// When Jest's globals are Jest's (src/config/jest-globals.ts, docs/rules.md *Jest's globals*): a closed grammar of the
// package's test script and its configuration, read from the trees of the diff; anything outside it is a reason, never
// a guess. The fixtures (fixtures/cases/*/jestg-*, contract-jest-global-*) show each with the real Jest.
import { describe, expect, it } from 'vitest';
import { jestGlobalsFor, jestGlobalsOfChange } from '../src/config/jest-globals.js';

type Files = Record<string, string>;
const pkg = (test: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ name: 'app', private: true, scripts: { test }, ...extra });
const certify = (files: Files, path = 'a.test.js') => jestGlobalsFor(path, (p) => files[p] ?? null, Object.keys(files));
const why = (files: Files, path?: string): string => {
  const c = certify(files, path);
  return c.certified ? 'certified' : c.why;
};

describe('the test script: exactly `[npx ]jest` and flags from a closed list', () => {
  it.each(['jest', 'npx jest', 'jest --ci', 'jest --coverage --runInBand', 'jest -i --verbose --silent', 'jest --passWithNoTests --detectOpenHandles --forceExit --colors --no-cache --watchAll=false'])('%s: certified', (test) => {
    expect(why({ 'package.json': pkg(test) })).toBe('certified');
  });

  it.each([
    ['jest a.test.js', 'passes `a.test.js` to jest'],
    ['jest --config jest.other.json', 'passes `--config` to jest'],
    ['jest --injectGlobals=false', 'passes `--injectGlobals=false` to jest'],
    ['jest --maxWorkers=2', 'passes `--maxWorkers=2` to jest'],
    ['cross-env CI=1 jest', 'is not one plain jest invocation'],
    ['jest && echo done', 'passes `&&` to jest'],
    ['vitest run', 'is not one plain jest invocation'],
    ['mocha', 'runs mocha, whose globals saidvsdid cannot certify'],
  ])('%s: not certified', (test, reason) => {
    expect(why({ 'package.json': pkg(test) })).toContain(reason);
  });

  it('a pretest or posttest script: npm runs it around jest', () => {
    expect(why({ 'package.json': pkg('jest', { scripts: { test: 'jest', pretest: 'node gen.js' } }) })).toContain('has a `pretest` script');
    expect(why({ 'package.json': pkg('jest', { scripts: { test: 'jest', posttest: 'echo' } }) })).toContain('has a `posttest` script');
  });

  it('no test script, or no package.json above the file', () => {
    expect(why({ 'package.json': JSON.stringify({ name: 'app' }) })).toContain('has no test script');
    expect(why({})).toContain('no package.json above the file');
  });
});

describe("the configuration: Jest's own resolution from the package's directory, JSON only, an allowlist of keys", () => {
  it("none: Jest's defaults, certified", () => {
    expect(why({ 'package.json': pkg('jest') })).toBe('certified');
  });

  it('a jest key or a jest.config.json with allowed keys: certified', () => {
    expect(why({ 'package.json': pkg('jest', { jest: { testEnvironment: 'jsdom', testMatch: ['**/*.test.js'], bail: 0, injectGlobals: true } }) })).toBe('certified');
    expect(why({ 'package.json': pkg('jest'), 'jest.config.json': '{"roots": ["<rootDir>"], "bail": false}' })).toBe('certified');
  });

  it.each(['js', 'ts', 'mjs', 'cjs', 'cts', 'mts'])('a jest.config.%s: never evaluated', (ext) => {
    expect(why({ 'package.json': pkg('jest'), [`jest.config.${ext}`]: 'module.exports = {}' })).toContain('is JavaScript, which saidvsdid never evaluates');
  });

  it('names compare without case, as Jest finds them on Windows and macOS', () => {
    expect(why({ 'package.json': pkg('jest'), 'JEST.CONFIG.CJS': 'module.exports = { injectGlobals: false }' })).toContain('JEST.CONFIG.CJS is JavaScript');
    expect(why({ 'package.json': pkg('jest'), 'Jest.Config.JSON': '{}' })).toContain('is jest.config.json in another case');
    expect(why({ 'PACKAGE.JSON': pkg('jest') })).toContain('is package.json in another case');
  });

  it('both a jest key and a jest.config.json: Jest refuses two', () => {
    expect(why({ 'package.json': pkg('jest', { jest: {} }), 'jest.config.json': '{}' })).toContain('Jest refuses two configurations');
  });

  it.each([
    [{ injectGlobals: false }, 'sets `injectGlobals` to false'],
    [{ testEnvironment: './my-env.js' }, "not one of Jest's own"],
    [{ bail: 1 }, 'sets `bail` to 1'],
    [{ bail: true }, 'sets `bail` to true'],
    [{ testRunner: 'jest-circus/runner' }, 'sets `testRunner`'],
    [{ runner: 'jest-runner' }, 'sets `runner`'],
    [{ preset: 'ts-jest' }, 'sets `preset`'],
    [{ projects: ['a'] }, 'sets `projects`'],
    [{ setupFiles: ['./s.js'] }, 'sets `setupFiles`'],
    [{ setupFilesAfterEnv: ['./s.js'] }, 'sets `setupFilesAfterEnv`'],
    [{ transform: {} }, 'sets `transform`'],
    [{ globals: {} }, 'sets `globals`'],
  ])('%j: not certified', (jest, reason) => {
    expect(why({ 'package.json': pkg('jest', { jest }) })).toContain(reason);
  });

  it('a duplicate key, or a configuration that is not an object', () => {
    expect(why({ 'package.json': pkg('jest'), 'jest.config.json': '{"bail": 0, "bail": 1}' })).toContain('repeats the key "bail"');
    expect(why({ 'package.json': pkg('jest', { jest: 'x' }) })).toContain("`jest` key is not an object");
  });

  it('the nearest package.json above the file is its package (npm runs its scripts there)', () => {
    const files = { 'package.json': pkg('jest'), 'packages/web/package.json': pkg('vitest run'), 'packages/web/a.test.js': '' };
    expect(why(files, 'packages/web/a.test.js')).toContain('is not one plain jest invocation');
    expect(why({ 'package.json': pkg('jest'), 'src/deep/a.test.js': '' }, 'src/deep/a.test.js')).toBe('certified');
  });

  it("without the repository's listing nothing is certified", () => {
    expect(jestGlobalsFor('a.test.js', () => pkg('jest'), null)).toMatchObject({ certified: false });
  });
});

describe('a changed file: both sides alike, and no docblock', () => {
  const side = (files: Files, source = "test('a', () => {})\n") => ({ path: 'a.test.js', source, read: (p: string) => files[p] ?? null, files: Object.keys(files) });

  it('both sides certified with the same invocation and configuration', () => {
    expect(jestGlobalsOfChange([side({ 'package.json': pkg('jest') }), side({ 'package.json': pkg('jest') })])).toMatchObject({ certified: true });
  });

  it('the configuration differs between base and head: not certified', () => {
    expect(jestGlobalsOfChange([side({ 'package.json': pkg('jest') }), side({ 'package.json': pkg('jest', { jest: { verbose: true } }) })])).toEqual({ certified: false, why: 'the test script or the Jest configuration differs between base and head' });
  });

  it('one side not certified: the file is not', () => {
    expect(jestGlobalsOfChange([side({ 'package.json': pkg('jest') }), side({ 'package.json': pkg('jest --config x.json') })])).toMatchObject({ certified: false });
  });

  // Written in two pieces: Vitest itself reads that docblock in its own test files.
  it('a docblock naming its own environment on either side', () => {
    const files = { 'package.json': pkg('jest') };
    expect(jestGlobalsOfChange([side(files), side(files, `/** @${'jest-environment'} node */\n`)])).toMatchObject({ certified: false, why: expect.stringContaining('names its own environment') });
  });
});
