import { describe, expect, it } from 'vitest';
import { formatTags } from '../src/slug';

describe('slug', () => {
  it('formats tags', () => {
    expect(formatTags(['a', 'b', 'c'])).toMatchInlineSnapshot(`"#a #b #c"`);
  });
});
