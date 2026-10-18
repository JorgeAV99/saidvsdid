import { test } from 'node:test';

test.skip('a', () => {});
test('b', () => { throw new Error('broken'); });
test.skip('c', () => {});
