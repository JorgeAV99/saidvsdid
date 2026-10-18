import { expect, it } from 'vitest';
import { enabledEvents, wanted } from '../src/alerts';

it('wanted reads a list', () => {
  expect(wanted('a,b')).toEqual(['a', 'b']);
});

it('defaults are on', () => {
  expect(enabledEvents('')).toEqual(['device', 'account']);
});
