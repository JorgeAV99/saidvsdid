import { test as base, expect } from '@playwright/test';

const test = base.extend({ res: async ({}, use) => { await use(1); throw new Error('teardown failed'); } });

test('service', ({ res }) => expect(res).toBe(2));
