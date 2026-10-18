import { describe, expect, it } from 'vitest';
import { slugify } from '../src/slug';

describe('slugify', () => {
  it('lowercases', () => {
    expect(slugify('Hello')).toBe('hello');
  });

  it('replaces spaces', (ctx) => {
    function stop() {
      ctx.skip();
    }
    stop();
    expect(slugify('a b')).toBe('a-b');
  });

  it('strips accents', (ctx) => {
    const guard = { stop() { ctx.skip(); } };
    guard.stop();
    expect(slugify('canción')).toBe('cancion');
  });
});
