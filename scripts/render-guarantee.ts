// Rewrites docs/rules.md's rendered sections — the silence guarantee and the best-effort detection — from
// src/rules/guarantee.ts, exactly as test/contract-fixtures.test.ts compares them.
//
//   npx tsx scripts/render-guarantee.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderBestEffort, renderGuarantee } from '../src/rules/guarantee.js';

const RULES = fileURLToPath(new URL('../docs/rules.md', import.meta.url));
let text = readFileSync(RULES, 'utf8');
for (const [name, body] of [['silence-guarantee', renderGuarantee()], ['best-effort', renderBestEffort()]] as const) {
  const re = new RegExp(String.raw`(<!-- ${name}:start -->\n)[\s\S]*?(\n<!-- ${name}:end -->)`);
  if (!re.test(text)) throw new Error(`docs/rules.md: no ${name} section`);
  text = text.replace(re, (_m, open: string, close: string) => `${open}${body}${close}`);
}
writeFileSync(RULES, text);
