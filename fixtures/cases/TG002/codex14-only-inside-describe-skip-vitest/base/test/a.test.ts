import { describe, expect, test } from 'vitest';

describe.skip('S', () => {
  test('A', () => expect(1).toBe(1));
});

test('B', () => expect(1).toBe(1));
