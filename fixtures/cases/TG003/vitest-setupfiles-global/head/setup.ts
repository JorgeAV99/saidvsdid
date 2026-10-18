import { test } from 'vitest';

// A project's own global `it`: its `skip` still runs the test.
(globalThis as Record<string, unknown>).it = Object.assign((name: string, fn: () => void) => test(name, fn), {
  skip: (name: string, fn: () => void) => test(name, fn),
});
