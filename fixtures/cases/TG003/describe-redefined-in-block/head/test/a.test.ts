import { expect, it } from 'vitest';

{
  // A `describe` of this block: it calls its callback, it does not skip it.
  const describe = Object.assign((name: string, fn: () => void) => fn(), { skip: (name: string, fn: () => void) => fn() });
  describe.skip('group', () => {
    it('adds', () => {
      expect(1 + 1).toBe(2);
    });
  });
}
