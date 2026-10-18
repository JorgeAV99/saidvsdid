import { describe, expect, it } from 'vitest';
import { slugify } from '../src/slug';
import { tagsOf } from './support/tags';

const slugOf = (input: string, expected: string) => {
  expect(slugify(input)).toBe(expected);
};

describe('slug', () => {
  it('lowercases and dashes', () => {
    slugOf('Hello World', 'hello-world');
  });

  it('parses tags', () => {
    tagsOf('a, b,,c', ['a', 'b', 'c']);
  });
});
