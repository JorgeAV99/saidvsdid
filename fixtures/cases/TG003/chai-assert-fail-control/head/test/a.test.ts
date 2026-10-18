import { assert, expect } from 'chai';
import { describe, it } from 'vitest';

describe('a', () => {
  it('parses', () => {
    expect(JSON.parse('1')).to.equal(1);
    try {
      JSON.parse('{');
      assert.fail('expected a syntax error');
    } catch (e) {
      expect(e).to.be.instanceOf(SyntaxError);
    }
    if (Number.isNaN(JSON.parse('1'))) expect.fail('not a number');
  });
});
