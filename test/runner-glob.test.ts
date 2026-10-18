// The runner glob dialects, checked against the real picomatch (the matcher
// Vitest and Jest use) on a grid of patterns and paths, and against known
// Python fnmatch behaviour.
import picomatch from 'picomatch';
import { describe, expect, it } from 'vitest';
import { expandBraces, fnmatchRegExp, picomatchRegExp } from '../src/util/runner-glob.js';

const PATTERNS = [
  '**/*.{test,spec}.?(c|m)[jt]s?(x)',
  '**/node_modules/**',
  '**/.git/**',
  'tests/legacy/**',
  'tests/**/*.test.ts',
  'tests/unit/**/*.test.ts',
  '**/__tests__/**/*.?([mc])[jt]s?(x)',
  '**/?(*.)+(spec|test).?([mc])[jt]s?(x)',
  '**/*.@(spec|test).?(c|m)[jt]s?(x)',
  'src/**',
  '*.test.ts',
  './tests/*.spec.js',
  '**/{fixtures,data}/**',
  'e2e/**/*.e2e.ts',
  '**/*.test.[jt]s',
];

const PATHS = [
  'a.test.ts',
  'tests/a.test.ts',
  'tests/unit/a.test.ts',
  'tests/unit/deep/b.spec.tsx',
  'tests/legacy/old.test.ts',
  'tests/legacy',
  'src/__tests__/x.js',
  'src/__tests__/deep/x.mjs',
  'node_modules/pkg/a.test.js',
  'pkg/node_modules/x/a.test.js',
  '.git/hooks/a.test.ts',
  '.hidden/a.test.ts',
  'e2e/login.spec.ts',
  'e2e/flows/cart.e2e.ts',
  'tests/fixtures/data.test.ts',
  'lib/data/x.test.cjs',
  'a.spec.jsx',
  'src/app.ts',
  'tests/a.test.ts.snap',
];

describe('picomatchRegExp agrees with picomatch (dot: true)', () => {
  for (const pattern of PATTERNS) {
    it(pattern, () => {
      const re = picomatchRegExp(pattern);
      expect(re).not.toBeNull();
      const isMatch = picomatch(pattern, { dot: true });
      const disagreements = PATHS.filter((p) => re!.test(p) !== isMatch(p));
      expect(disagreements).toEqual([]);
    });
  }

  it.each(['!tests/**', 'tests/!(legacy)/**', 'file{1..3}.ts'])('%s is reported as unsupported', (pattern) => {
    expect(picomatchRegExp(pattern)).toBeNull();
  });

  it('expands nested braces', () => {
    expect(expandBraces('a{b,c{d,e}}f')).toEqual(['abf', 'acdf', 'acef']);
  });
});

describe('fnmatchRegExp (Python fnmatch)', () => {
  it.each([
    ['test_*.py', 'test_io.py', true],
    ['test_*.py', 'tests/test_io.py', false],
    ['*_test.py', 'io_test.py', true],
    ['tests/legacy/*', 'tests/legacy/deep/test_a.py', true],
    ['*/legacy/*', 'tests/legacy/test_a.py', true],
    ['test_[!x]*.py', 'test_io.py', true],
    ['test_[!x]*.py', 'test_xio.py', false],
    ['tests/test_?.py', 'tests/test_a.py', true],
  ])('%s vs %s → %s', (pattern, path, expected) => {
    expect(fnmatchRegExp(pattern).test(path)).toBe(expected);
  });
});
