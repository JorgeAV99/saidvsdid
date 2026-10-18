import { expect, it } from 'vitest';
import { greet } from './greet';

it('greets by name', () => {
  expect(greet('Ada')).toBe('Hello, Ada');
});
