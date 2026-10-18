// The vocabulary is one definition (src/parse/vocabulary.ts): docs/rules.md lists it as rendered from it, every
// member of it, in each language, is a token of the contagion net — a name bound to it is marked, and a new use
// of that name is found with the member's kind — and the marker net counts each form it is written in.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JS_TOKENS, PY_TOKENS, renderVocabulary, vocabularyForms, type VocabularyForm } from '../src/parse/vocabulary.js';
import { contagionUses } from '../src/rules/contagion.js';
import { countMarkers } from '../src/rules/net.js';

const ROOT = resolve(__dirname, '..');

describe('the vocabulary is one definition', () => {
  it('docs/rules.md lists it as src/parse/vocabulary.ts renders it', () => {
    const rules = readFileSync(join(ROOT, 'docs', 'rules.md'), 'utf8');
    const m = /<!-- vocabulary:start -->\n([\s\S]*?)\n<!-- vocabulary:end -->/.exec(rules);
    expect(m?.[1]).toBe(renderVocabulary());
  });

  it('every form groups members of the tokens, and every token is in a form', () => {
    for (const [lang, tokens] of [['js', JS_TOKENS], ['python', PY_TOKENS]] as const) {
      const named = vocabularyForms().filter((f) => f.lang === lang).flatMap((f) => f.names.map((n) => [n, f.kind] as const));
      for (const [n, kind] of named) expect(tokens[n], `${lang} ${n}`).toBe(kind);
      expect(new Set(named.map(([n]) => n))).toEqual(new Set(Object.keys(tokens)));
    }
  });

  it.each(Object.entries(JS_TOKENS))('JS/TS `%s` is a token: a name bound to it is marked, its new use found with its kind', async (member, kind) => {
    const source = `import * as g from '@jest/globals';\nconst first = g.${member};\nconst omit = first;\nomit('b', () => {});\n`;
    const uses = await contagionUses('test/a.test.ts', source, []);
    expect(uses.map((u) => [u.callee, [...u.mark.kinds]])).toEqual([['omit', [kind]]]);
  });

  it.each(Object.entries(PY_TOKENS))('Python `%s` is a token: a name bound to it is marked, its new use found with its kind', async (member, kind) => {
    const source = `import pytest\nfirst = pytest.${member}\nomit = first\n\n\ndef test_a():\n    raise omit\n`;
    const uses = await contagionUses('test_a.py', source, []);
    expect(uses.map((u) => [u.callee, [...u.mark.kinds]])).toEqual([['omit', [kind]]]);
  });

  /** One occurrence of a form, as the code writes it. */
  const WRITTEN: Record<VocabularyForm['shape'], (name: string) => string> = {
    member: (n) => `it.${n}('a', () => {});`,
    'test-root-member': (n) => `test.${n}();`,
    'root-call': (n) => `${n}('a', () => {});`,
    option: (n) => `it('a', { ${n}: true }, () => {});`,
    mark: (n) => `@pytest.mark.${n}\ndef test_a():\n    pass`,
    'pytest-call': (n) => `pytest.${n}("x")`,
    'method-call': (n) => `self.${n}("x")`,
    raise: (n) => `raise unittest.${n}`,
    unittest: (n) => `x = unittest.${n}`,
    decorator: (n) => `@${n}\ndef test_a():\n    pass`,
  };

  it.each(vocabularyForms().flatMap((f) => f.names.map((n) => [`${f.lang} ${f.shape} ${n}`, f, n] as const)))('the marker net counts %s', async (_title, f, n) => {
    const path = f.lang === 'js' ? 'test/a.test.ts' : 'test_a.py';
    const counts = await countMarkers(path, `${WRITTEN[f.shape](n)}\n`);
    expect(counts[f.kind], WRITTEN[f.shape](n)).toBe(1);
  });
});
