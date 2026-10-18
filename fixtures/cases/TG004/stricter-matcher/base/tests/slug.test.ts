import { describe, expect, it } from 'vitest';
import { parseTags } from '../src/slug';

describe('slug', () => {
  it('parses tags', () => {
    expect(parseTags('a, b,,c')).toEqual(['a', 'b', 'c']);
  });
});
