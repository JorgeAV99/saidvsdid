import { describe, expect, it } from 'vitest';
import { slugify } from '../src/slug';

describe.skip('slugify', () => {
  it('lowercases', () => {
    expect(slugify('Hello')).toBe('hello');
  });

  it('replaces spaces', () => {
    expect(slugify('a b')).toBe('a-b');
  });

  it('strips accents', () => {
    expect(slugify('canción')).toBe('cancion');
  });
});
