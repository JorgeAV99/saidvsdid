import { expect, it } from 'vitest';
import { isMember } from '../src/account';

it('a member has an id', () => {
  expect(isMember('u1')).toBe(true);
});
