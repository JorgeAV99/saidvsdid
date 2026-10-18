import { expect, test } from 'vitest';

test.fails('X', { fails: false }, () => expect(1).toBe(1));
