// The project's own `skip`: it still runs the test.
it.skip = (name, fn) => test(name, fn);

it('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
