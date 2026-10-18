import { test as base, expect } from 'vitest';

const test = base.extend<{ res: number }>({ res: async ({}, use) => { throw new Error('setup failed'); } });

test('service', ({ res }) => expect(res).toBe(1));
