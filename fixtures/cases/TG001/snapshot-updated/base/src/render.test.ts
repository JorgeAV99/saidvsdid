import { expect, it } from 'vitest';
import { render } from './render';

it('renders a card', () => {
  expect(render({ title: 'Hi' })).toMatchSnapshot();
});
