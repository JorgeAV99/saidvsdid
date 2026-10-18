// Jest's globals, with no import.

const later = it.todo;

it('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('adds');
