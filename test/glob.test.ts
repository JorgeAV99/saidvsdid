import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesAny } from '../src/util/glob.js';

describe('globToRegExp', () => {
  it.each([
    ['fixtures/**', 'fixtures/cases/TG001/a.test.ts', true],
    ['fixtures/**', 'src/fixtures/a.test.ts', false],
    ['fixtures/', 'fixtures/x/y.ts', true],
    ['**/vendor/**', 'a/b/vendor/c.test.ts', true],
    ['**/vendor/**', 'vendor/c.test.ts', true],
    ['*.snap', 'src/__snapshots__/a.test.ts.snap', true],
    ['src/*.test.ts', 'src/a.test.ts', true],
    ['src/*.test.ts', 'src/deep/a.test.ts', false],
    ['a?.ts', 'ab.ts', true],
    ['a.ts', 'xa.ts', false],
  ])('%s matches %s: %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });

  it('normalises Windows separators', () => {
    expect(matchesAny('fixtures\\cases\\a.ts', [globToRegExp('fixtures/**')])).toBe(true);
  });
});
