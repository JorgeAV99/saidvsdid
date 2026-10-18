import { expect, it } from 'vitest';
import { slug } from '../src/utils';

it('slugs', () => {
  expect(slug('A B')).toBe('a-b');
});
