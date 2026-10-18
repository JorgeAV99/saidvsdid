import { describe, expect, test } from 'vitest';

test('X', { only: true, fails: true }, () => expect(1).toBe(1));
