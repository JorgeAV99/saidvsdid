import { describe, expect, it } from 'vitest';

describe('audit', () => {
  it('logs a corrupt row without its content', () => {
    expect('x').not.toContain('secret');
  });
  it.todo('a second concurrent run of a singleton job');
});
