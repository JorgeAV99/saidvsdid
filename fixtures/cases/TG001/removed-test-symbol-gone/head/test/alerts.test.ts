import { expect, it } from 'vitest';
import { enabledEvents } from '../src/alerts';

it('defaults are on', () => {
  expect(enabledEvents('')).toEqual(['device', 'account']);
});
