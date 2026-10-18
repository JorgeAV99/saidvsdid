// Invariants of the repository itself: vendored grammars, docs vs. rules.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainRule } from '../src/explain.js';
import { RULE_IDS } from '../src/rules/index.js';

describe('vendored grammars', () => {
  const manifest = JSON.parse(readFileSync(new URL('../grammars/manifest.json', import.meta.url), 'utf8')) as {
    grammars: { file: string; sha256: string }[];
  };

  it.each(manifest.grammars)('$file matches its recorded SHA-256', ({ file, sha256 }) => {
    const bytes = readFileSync(new URL(`../grammars/${file}`, import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
  });
});

describe('docs/rules.md', () => {
  it.each(RULE_IDS)('documents %s', (id) => {
    const section = explainRule(id);
    expect(section).not.toBeNull();
    expect(section!.split('\n')[0]).toMatch(new RegExp(`^## ${id} `));
  });
});
