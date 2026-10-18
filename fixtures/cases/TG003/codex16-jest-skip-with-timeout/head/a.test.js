import { describe, expect, test } from '@jest/globals';

test('other', () => expect(1).toBe(1));
test.skip('X', () => expect(1).toBe(1), 1000);
