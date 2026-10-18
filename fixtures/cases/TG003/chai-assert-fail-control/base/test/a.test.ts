import { assert, expect } from 'chai';
import { describe, it } from 'vitest';

describe('a', () => {
  it('parses', () => {
    expect(JSON.parse('1')).to.equal(1);
  });
});
