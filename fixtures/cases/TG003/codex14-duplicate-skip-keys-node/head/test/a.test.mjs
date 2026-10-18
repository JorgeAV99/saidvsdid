import { test } from 'node:test';
import assert from 'node:assert';

test('X', { skip: true, skip: false }, () => assert.equal(1, 1));
