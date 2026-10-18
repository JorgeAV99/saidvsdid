import { test, expect, afterEach } from '@jest/globals';

afterEach(() => { Promise.reject(new Error('cleanup')); });

test.failing('service', () => expect(1).toBe(1));
