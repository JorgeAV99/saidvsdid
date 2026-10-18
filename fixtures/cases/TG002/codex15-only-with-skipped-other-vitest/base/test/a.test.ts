import { expect, test } from 'vitest';

test('A', () => expect(1).toBe(1));
test.skip('B', () => expect(1).toBe(1));
