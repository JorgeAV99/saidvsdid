import { test, afterEach } from 'node:test';
import assert from 'node:assert';

afterEach(() => { throw new Error('cleanup failed'); });

test('service', () => assert.strictEqual(1, 1));
