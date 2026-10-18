import { describe, expect, it } from 'vitest';
import { slugify } from '../src/slug';

describe('slugify', () => {
  it('lowercases', () => {
    expect(slugify('Hello')).toBe('hello');
  });

  it('replaces spaces', () => {
    expect(slugify('a b')).toBe('a-b');
  });

  it.skipIf(legacyMode)('strips accents', () => {
    expect(slugify('canción')).toBe('cancion');
  });
});
