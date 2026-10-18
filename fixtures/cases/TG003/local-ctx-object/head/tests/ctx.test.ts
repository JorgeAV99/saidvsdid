import { describe, expect, it } from 'vitest';

describe('ctx', () => {
  it('shadows the context parameter', (ctx) => {
    expect(ctx.task.name).toBe('shadows the context parameter');
    {
      const ctx = { skip() { return 1; } };
      expect(ctx.skip()).toBe(1);
    }
  });

  it('has no context parameter', () => {
    const ctx = { skip() { return 1; } };
    expect(ctx.skip()).toBe(1);
  });
});
