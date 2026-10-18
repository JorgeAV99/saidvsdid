import { describe, expect, it } from 'vitest';

describe('ctx', () => {
  it('shadows the context parameter', (ctx) => {
    expect(ctx.task.name).toBe('shadows the context parameter');
  });

  it('has no context parameter', () => {
    expect(1).toBe(1);
  });
});
