import { test, expect } from '@playwright/test';

test.afterEach(() => { throw new Error('cleanup failed'); });

test('service', () => expect(1).toBe(1));
