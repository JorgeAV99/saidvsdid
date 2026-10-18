import { test, expect, afterAll } from 'vitest';

afterAll(() => { throw new Error('cleanup'); });

test.fails('service', () => expect(1).toBe(1));
