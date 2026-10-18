import { expect, test } from 'vitest';

test.skip.fails('X', () => expect(1).toBe(1));
