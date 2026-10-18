import { test, expect } from '@playwright/test';

test.skip('a', async () => expect(1).toBe(1));
test('b', async () => expect(1).toBe(2));
test.skip('c', async () => expect(1).toBe(1));
