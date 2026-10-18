import { test, expect, afterEach } from '@jest/globals';

afterEach(() => { throw new Error('cleanup failed'); });

test.failing('service', () => expect(1).toBe(2));
