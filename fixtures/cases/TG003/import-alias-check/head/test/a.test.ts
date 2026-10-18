import { it as check } from 'vitest';

check.skip('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
