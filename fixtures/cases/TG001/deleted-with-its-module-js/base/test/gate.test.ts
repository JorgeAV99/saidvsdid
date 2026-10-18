import { describe, expect, it } from 'vitest';
import { resolveAccess, STORAGE_KEY } from '../src/gate';

describe('gate', () => {
  it('unlocks with a stored email', () => {
    expect(resolveAccess('a@example.com')).toBe(true);
  });
  it('stays locked without one', () => {
    expect(resolveAccess(null)).toBe(false);
    expect(STORAGE_KEY).toBe('gate');
  });
});
