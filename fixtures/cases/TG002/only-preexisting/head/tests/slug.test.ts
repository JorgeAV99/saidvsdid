import { describe, expect, it } from 'vitest';
import { slugify } from '../src/slug';

describe('slugify', () => {
  it.only('lowercases', () => {
    expect(slugify('HeLLo')).toBe('hello');
  });

  it('replaces spaces', () => {
    expect(slugify('a b')).toBe('a-b');
  });

  it('strips accents', () => {
    expect(slugify('canción')).toBe('cancion');
  });
});
