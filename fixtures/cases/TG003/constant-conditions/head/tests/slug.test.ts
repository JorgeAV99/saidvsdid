import { describe, expect, it } from 'vitest';
import { slugify } from '../src/slug';

describe('slugify', () => {
  it.skipIf(false)('lowercases', () => {
    expect(slugify('Hello')).toBe('hello');
  });

  it.runIf(true)('replaces spaces', () => {
    expect(slugify('a b')).toBe('a-b');
  });

  it('strips accents', (ctx) => {
    ctx.skip(false);
    expect(slugify('canción')).toBe('cancion');
  });
});
