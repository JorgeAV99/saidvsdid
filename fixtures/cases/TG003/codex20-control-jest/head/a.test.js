import { test, expect, afterEach } from '@jest/globals';

afterEach(() => {});

test.failing('service', () => expect(1).toBe(1));
