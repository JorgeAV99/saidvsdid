import { describe, expect, it } from 'vitest';
import { Queue } from '../src/queue';

describe('queue', () => {
  it('starts empty', () => {
    expect(new Queue().size).toBe(0);
  });
  it('pops in FIFO order', () => {
    const q = new Queue<number>();
    q.push(1);
    q.push(2);
    expect(q.pop()).toBe(1);
  });
});
