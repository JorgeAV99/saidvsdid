import { describe, expect, it } from 'vitest';
import { normalize } from '../src/paths';

describe('paths', () => {
  it('normalizes separators', () => {
    expect(normalize('a\\b')).toBe('a/b');
  });

  // Symlinks need admin rights on Windows runners.
  it.skipIf(process.platform === 'win32')('resolves symlinks', async () => {
    expect(await normalize.real('link')).toBe('target');
  });
});
