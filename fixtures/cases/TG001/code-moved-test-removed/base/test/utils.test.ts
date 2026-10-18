import { expect, it } from 'vitest';
import { formatDate, slug } from '../src/utils';

it('formats a date', () => {
  expect(formatDate(new Date('2020-01-02T00:00:00Z'))).toBe('2020-01-02');
});

it('slugs', () => {
  expect(slug('A B')).toBe('a-b');
});
