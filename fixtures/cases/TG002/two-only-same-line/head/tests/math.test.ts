import { describe, expect, it } from 'vitest';

describe.only('a', () => { it('x', () => { expect(1).toBe(1); }); }); describe.only('b', () => { it('y', () => { expect(2).toBe(2); }); });
it('z', () => { expect(3).toBe(3); });
