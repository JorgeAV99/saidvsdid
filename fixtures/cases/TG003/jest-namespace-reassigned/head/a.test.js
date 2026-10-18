let jg = require('@jest/globals');

// The project's own `it`: its `skip` still runs the test.
const run = jg.it;
jg = { it: Object.assign((name, fn) => run(name, fn), { skip: (name, fn) => run(name, fn) }) };

jg.it.skip('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
