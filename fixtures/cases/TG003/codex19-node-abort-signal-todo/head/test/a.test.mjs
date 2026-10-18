import { test } from 'node:test';

test('service', { signal: AbortSignal.abort(), todo: true }, () => console.log('BODY EXECUTED'));
