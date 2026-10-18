import { describe, expect, it } from 'vitest';
import { slugify } from '../src/slug';

describe('slugify', () => {
  it('lowercases', () => {
    expect(slugify('Hello')).toBe('hello');
  });

  it('replaces spaces', () => {
    expect(slugify('a b')).toBe('a-b');
  });

  it('strips accents', () => {
    expect(slugify('canción')).toBe('cancion');
  });
  it.todo('handles emoji');
  it.todo('truncates long input');
});
