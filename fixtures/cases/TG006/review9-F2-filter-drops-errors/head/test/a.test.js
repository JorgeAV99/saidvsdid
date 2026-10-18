import {it,expect} from 'vitest';it('a',()=>{Promise.reject(new Error('late rejection'));expect(1).toBe(1)});
