import { describe, expect, it } from 'vitest';

describe.each([it])('group %#', (t) => {
  t('inner', () => {
    expect(1).toBe(1);
  });
});

it('outside', () => {
  expect(2).toBe(2);
});
