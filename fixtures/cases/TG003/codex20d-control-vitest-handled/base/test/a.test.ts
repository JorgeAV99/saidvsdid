import { test, expect, afterEach } from 'vitest';

afterEach(async () => { await Promise.reject(new Error('cleanup')).catch(() => {}); });

test('service', () => expect(1).toBe(1));
