import { expect, test } from 'vitest';

test.only('A', () => expect(1).toBe(1));
test.skip('B', () => expect(1).toBe(1));
