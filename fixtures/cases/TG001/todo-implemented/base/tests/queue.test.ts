import { describe, expect, it } from 'vitest';
import { Queue } from '../src/queue';

describe('queue', () => {
  it('starts empty', () => {
    expect(new Queue().size).toBe(0);
  });
  it.todo('pops in FIFO order');
  it.todo('is fair under contention');
});
