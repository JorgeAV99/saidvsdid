import { test, expect } from '@playwright/test';

test.afterEach(() => {});

test.fail('service', () => expect(1).toBe(2));
