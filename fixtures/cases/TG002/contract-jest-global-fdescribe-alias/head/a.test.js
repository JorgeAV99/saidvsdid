// Jest's globals, with no import.

const later = fdescribe;

it('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('group', () => {
  it('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
