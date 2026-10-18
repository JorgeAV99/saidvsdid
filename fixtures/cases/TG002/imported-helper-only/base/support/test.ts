import { test as base } from 'vitest';

export const test = Object.assign((name: string, fn: () => void) => base(name, fn), {
  skip: (name: string, fn: () => void) => base(name, fn),
  only: (name: string, fn: () => void) => base(name, fn),
});
