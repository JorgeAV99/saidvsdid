import { describe, expect, test } from 'vitest';

describe('S', () => {
  test('live', () => expect(1).toBe(1));
  return;
  test.skip('X', () => expect(1).toBe(1));
});
