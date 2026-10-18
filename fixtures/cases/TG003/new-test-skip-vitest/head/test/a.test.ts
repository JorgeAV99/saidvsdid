import { describe, expect, it } from 'vitest';

describe('a', () => {
  it('adds', () => {
    expect(1 + 1).toBe(2);
  });
  it.skip('subtracts, once the API exists', () => {
    expect(2 - 1).toBe(1);
  });
  it.skipIf(process.platform === 'win32')('reads a symlink', () => {
    expect(true).toBe(true);
  });
});
