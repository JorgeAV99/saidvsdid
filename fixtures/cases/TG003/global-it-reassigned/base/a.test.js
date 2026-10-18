// The global `it` is reassigned: whether `it.skip` is jest's cannot be known.
globalThis.it = Object.assign((name, fn) => test(name, fn), { skip: (name, fn) => test(name, fn) });

it('adds', () => {
  expect(1 + 1).toBe(2);
});
