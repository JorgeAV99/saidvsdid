import { jest, test, expect } from '@jest/globals';

jest.retryTimes(1);
let n = 0;
test('service', () => expect(++n).toBe(1));
