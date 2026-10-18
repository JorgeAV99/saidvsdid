import assert from 'node:assert/strict';
import test from 'node:test';

function fixture() {
  return { state: { reviewFailure: false, published: [] }, publish() { this.state.published.push(this.state.reviewFailure); } };
}

test('publishing records the review state', () => {
  const f = fixture();
  f.publish();
  assert.deepEqual(f.state.published, [false]);
});
