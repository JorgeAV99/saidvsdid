import { describe, expect, test } from '@jest/globals';

describe('S', () => {
  test('live', () => expect(1).toBe(1));
  return;
  test.only('X', () => expect(1).toBe(1));
});
