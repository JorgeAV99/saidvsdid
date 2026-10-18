import { test, expect } from 'vitest';

let n = 0;
test('service', { retry: 1 }, () => expect(++n).toBe(2));
