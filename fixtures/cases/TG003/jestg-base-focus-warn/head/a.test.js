test.only('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test.skip('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
