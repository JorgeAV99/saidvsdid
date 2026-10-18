const { test } = require('@jest/globals');

// A project's own global `it`: its `skip` still runs the test.
globalThis.it = Object.assign((name, fn) => test(name, fn), {
  skip: (name, fn) => test(name, fn),
});
