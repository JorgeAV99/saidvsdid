import assert from 'node:assert/strict';
import test from 'node:test';

function guard(user, deliver) {
  if (user !== 'owner') throw Object.assign(new Error('no'), { statusCode: 403 });
  deliver();
}

test('only the owner receives the file', () => {
  assert.throws(() => guard('guest', () => assert.fail('must not receive a file')), { statusCode: 403 });
  guard('owner', () => {});
});
