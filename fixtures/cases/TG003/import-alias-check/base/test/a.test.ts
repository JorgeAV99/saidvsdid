import { it as check } from 'vitest';

check('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
