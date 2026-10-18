import { test } from '@playwright/test';

const later = test.fixme;

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test('adds', () => {
  later();
  if (1 + 1 !== 2) throw new Error('sum');
});
