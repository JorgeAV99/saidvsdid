import { expect, test } from 'vitest';

namespace Helpers {
  export const api = 1;
}

test('adds', () => {
  expect(1 + 1).toBe(Helpers.api + 1);
});
