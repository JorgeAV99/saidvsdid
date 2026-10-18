import { describe, expect, test } from 'vitest';

test('X', () => expect(1).toBe(1));
test('X', () => expect(1).toBe(1));
test.fails('X', () => expect(1).toBe(2));
