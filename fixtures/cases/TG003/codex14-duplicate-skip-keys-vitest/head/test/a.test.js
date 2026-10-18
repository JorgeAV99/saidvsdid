import { expect, test } from 'vitest';

test('X', { skip: true, skip: false }, () => expect(1).toBe(1));
