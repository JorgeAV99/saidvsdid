import { test, expect } from 'vitest';

test.skip('a', () => expect(1).toBe(1));
test('b', () => expect(1).toBe(2));
test.skip('c', () => expect(1).toBe(1));
