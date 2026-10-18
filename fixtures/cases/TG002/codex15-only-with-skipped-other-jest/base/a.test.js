import { expect, test } from '@jest/globals';

test('A', () => expect(1).toBe(1));
test.skip('B', () => expect(1).toBe(1));
