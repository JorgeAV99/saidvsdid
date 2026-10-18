import { describe, expect, it } from 'vitest';
import { parseTags, slugify } from '../src/slug';

describe('slug', () => {
  it('lowercases and dashes', () => {
    expect(slugify('Hello World')).toBeTruthy();
  });

  it('parses tags', () => {
    expect(parseTags('a, b,,c')).toBeDefined();
  });
});
