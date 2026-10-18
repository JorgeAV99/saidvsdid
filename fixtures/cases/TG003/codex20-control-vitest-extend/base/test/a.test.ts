import { test as base, expect } from 'vitest';

const test = base.extend<{ res: number }>({ res: async ({}, use) => { await use(1); } });

test('a', ({ res }) => expect(res).toBe(1));
test('b', ({ res }) => expect(res).toBe(2));
