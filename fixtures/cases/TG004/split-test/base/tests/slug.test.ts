import { describe, expect, it } from 'vitest';
import { formatTags, parseTags, slugify } from '../src/slug';

describe('tags', () => {
  it('parses and formats tags', () => {
    const tags = parseTags('a, b,,c');
    expect(tags).toEqual(['a', 'b', 'c']);
    expect(formatTags(tags)).toBe('#a #b #c');
  });

  it('slugifies', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
});
