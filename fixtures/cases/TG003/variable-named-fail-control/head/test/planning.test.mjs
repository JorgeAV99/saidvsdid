import assert from 'node:assert/strict';
import test from 'node:test';

function fixture() {
  return { state: { reviewFailure: false, published: [] }, publish() { this.state.published.push(this.state.reviewFailure); } };
}

test('publishing records the review state', () => {
  for (const fail of [false, true]) {
    const f = fixture();
    f.state.reviewFailure = fail;
    f.publish();
    assert.deepEqual(f.state.published, [fail]);
  }
});
