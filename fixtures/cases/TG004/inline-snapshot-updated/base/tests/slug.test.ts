import { describe, expect, it } from 'vitest';
import { formatTags } from '../src/slug';

describe('slug', () => {
  it('formats tags', () => {
    expect(formatTags(['a', 'b'])).toMatchInlineSnapshot(`"#a #b"`);
  });
});
