import { fileURLToPath } from 'node:url';
import { Language, Parser } from 'web-tree-sitter';
import type { LanguageId } from './types.js';

// Grammars are vendored WASM files (see grammars/manifest.json). This module
// lives at src/parse/ (tests) and dist/parse/ (published), both two levels
// below the package root, so the same relative URL works for both.
const GRAMMAR_DIR = new URL('../../grammars/', import.meta.url);

const GRAMMAR_FILES: Record<LanguageId, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm',
};

let initPromise: Promise<void> | undefined;
const parsers = new Map<LanguageId, Promise<Parser>>();

/** Returns a parser for `lang`, loading the runtime and grammar on first use. */
export function getParser(lang: LanguageId): Promise<Parser> {
  let parser = parsers.get(lang);
  if (!parser) {
    parser = (async () => {
      initPromise ??= Parser.init();
      await initPromise;
      const language = await Language.load(fileURLToPath(new URL(GRAMMAR_FILES[lang], GRAMMAR_DIR)));
      const p = new Parser();
      p.setLanguage(language);
      return p;
    })();
    parsers.set(lang, parser);
  }
  return parser;
}

export function languageForPath(path: string): LanguageId | null {
  const lower = path.toLowerCase();
  if (/\.(?:ts|mts|cts)$/.test(lower)) return lower.endsWith('.d.ts') ? null : 'typescript';
  // JavaScript is parsed with the TSX grammar, a superset that also accepts JSX.
  if (/\.(?:tsx|js|jsx|mjs|cjs)$/.test(lower)) return 'tsx';
  if (lower.endsWith('.py')) return 'python';
  return null;
}
