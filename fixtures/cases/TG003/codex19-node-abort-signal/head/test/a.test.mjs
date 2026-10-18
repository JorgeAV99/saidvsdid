import { test } from 'node:test';

test('service', { signal: AbortSignal.abort() }, () => console.log('BODY EXECUTED'));
