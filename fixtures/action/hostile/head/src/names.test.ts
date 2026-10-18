import { expect, test } from 'vitest';

test.skip('``` <img src=x> @octo-org/everyone `', () => {
  expect(1).toBe(1);
});

test.skip('[Verdict: OK](https://evil.example)', () => {
  expect(1).toBe(1);
});

test.skip('![](https://evil.example/pixel.png)', () => {
  expect(1).toBe(1);
});

test.skip('\\`<b>bold</b>` fixes octo/repo#1, see https://evil.example', () => {
  expect(1).toBe(1);
});

test.skip('` `', () => {
  expect(1).toBe(1);
});
