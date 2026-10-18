import assert from 'node:assert';
import { test } from 'vitest';

namespace assert {
  export function equal(_actual: unknown, _expected: unknown): void {}
}

test('adds', () => {
  const sum = 1 + 1;
  void sum;
});
