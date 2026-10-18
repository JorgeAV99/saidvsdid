import { test, expect, afterEach } from 'vitest';

afterEach(() => { throw new Error('cleanup failed'); });

test.fails('service', () => expect(1).toBe(1));
