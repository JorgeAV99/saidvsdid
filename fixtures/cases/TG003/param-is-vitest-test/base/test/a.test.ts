import { describe, expect } from 'vitest';

// vitest passes its `test` to a describe factory: this `it` is the runner, though a parameter.
describe('group', (it) => {
  it('adds', () => {
    expect(1 + 1).toBe(2);
  });
});
