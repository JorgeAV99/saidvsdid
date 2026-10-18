import { test, expect, afterEach } from 'vitest';

afterEach(() => { Promise.reject(new Error('cleanup')); });

test.fails('service', () => expect(1).toBe(1));
