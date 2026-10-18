import { test } from 'node:test';

test('a', () => {});
test('b', () => { throw new Error('broken'); });
test.skip('c', () => {});
