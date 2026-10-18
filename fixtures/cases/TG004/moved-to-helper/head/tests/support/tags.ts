import { expect } from 'vitest';
import { parseTags } from '../../src/slug';

export function tagsOf(input: string, expected: string[]): void {
  expect(parseTags(input)).toEqual(expected);
}
