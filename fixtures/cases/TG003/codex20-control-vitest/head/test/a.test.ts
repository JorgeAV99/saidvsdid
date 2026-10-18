import { test, expect, afterEach } from 'vitest';

afterEach(() => {});

test.fails('service', () => expect(1).toBe(2));
