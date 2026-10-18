import { describe, expect, it } from 'vitest';
import { slugify } from '../src/slug';

describe('slugify', () => {
  // Tip: use it.only('lowercases', ...) locally, never commit it.
  it('lowercases', () => {
    expect(slugify('Hello')).toBe('hello');
  });

  it('replaces spaces', () => {
    expect(slugify('a b')).toBe('a-b');
  });

  it('strips accents', () => {
    expect(slugify('canción')).toBe('cancion');
  });

  it('keeps "it.only" literally when escaped', () => {
    expect(slugify('it.only')).toBe('it-only');
  });

  it('only keeps ascii', () => {
    expect(slugify('ü')).toBe('u');
  });
});
