import { test, expect } from 'vitest';

let n = 0;
test('service', { repeats: 1 }, () => expect(++n).toBeGreaterThan(0));
