import { test, expect, afterAll } from '@jest/globals';

afterAll(() => { throw new Error('cleanup'); });

test.failing('service', () => expect(1).toBe(1));
