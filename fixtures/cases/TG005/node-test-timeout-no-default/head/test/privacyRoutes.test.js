import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const route = (path) => (path.startsWith('/private') ? 403 : 200);

describe('privacy routes', { timeout: 60_000 }, () => {
  it('blocks private paths', { timeout: 120_000 }, () => {
    assert.equal(route('/private/x'), 403);
  });

  it('allows public paths', () => {
    assert.equal(route('/public'), 200);
  });
});
