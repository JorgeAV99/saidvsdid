import { test as base, expect } from 'vitest';

const test = base.extend<{ res: number }>({ res: async ({}, use) => { throw new Error('setup failed'); } });

test.fails('service', ({ res }) => expect(res).toBe(1));
