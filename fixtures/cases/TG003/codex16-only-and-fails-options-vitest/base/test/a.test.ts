import { describe, expect, test } from 'vitest';

test('X', { only: true, fails: false }, () => expect(1).toBe(1));
