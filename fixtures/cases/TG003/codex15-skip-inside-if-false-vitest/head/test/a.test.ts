import { expect, test } from 'vitest';

if (false) {
  test.skip('A', () => expect(1).toBe(1));
}
test('B', () => expect(1).toBe(1));
