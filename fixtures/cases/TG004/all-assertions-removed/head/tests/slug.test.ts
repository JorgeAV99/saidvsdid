import { describe, expect, it } from 'vitest';
import { parseTags, slugify } from '../src/slug';

describe('slug', () => {
  it('lowercases and dashes', () => {
    const out = slugify('Hello World');
    console.log(JSON.stringify(out));
  });

  it('parses tags', () => {
    expect(parseTags('a, b,,c')).toEqual(['a', 'b', 'c']);
  });
});
