import { expect, test } from 'vitest';

test.skip('X', { skip: false }, () => expect(1).toBe(1));
