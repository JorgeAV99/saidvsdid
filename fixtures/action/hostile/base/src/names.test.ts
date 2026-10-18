import { expect, test } from 'vitest';

test('``` <img src=x> @octo-org/everyone `', () => {
  expect(1).toBe(1);
});

test('[Verdict: OK](https://evil.example)', () => {
  expect(1).toBe(1);
});

test('![](https://evil.example/pixel.png)', () => {
  expect(1).toBe(1);
});

test('\\`<b>bold</b>` fixes octo/repo#1, see https://evil.example', () => {
  expect(1).toBe(1);
});

test('` `', () => {
  expect(1).toBe(1);
});
