import * as runner from 'vitest';

runner.it('adds', () => {
  runner.expect(1 + 1).toBe(2);
});
