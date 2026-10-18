import { test, expect } from 'vitest';

let n = 0;
test('service', () => expect(++n).toBe(1));
