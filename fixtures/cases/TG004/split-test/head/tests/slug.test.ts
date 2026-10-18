import { describe, expect, it } from 'vitest';
import { formatTags, parseTags, slugify } from '../src/slug';

describe('tags', () => {
  it('parses a comma-separated list', () => {
    const tags = parseTags('a, b,,c');
    expect(tags).toEqual(['a', 'b', 'c']);
  });

  it('formats tags as hashtags', () => {
    const tags = ['a', 'b', 'c'];
    expect(formatTags(tags)).toBe('#a #b #c');
  });

  it('slugifies', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
});
