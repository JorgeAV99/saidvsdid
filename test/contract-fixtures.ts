// Which fixtures carry each combination of the silence guarantee (src/rules/guarantee.ts, `contractCases`): a fixture
// with the real runner's evidence for that runner, whose head adds a line with the form — written from the runner's
// import or the test context, directly or through a simple alias defined in the same file — and whose expectation
// puts a TG002/TG003 finding of at least a WARN on that line. Read from the fixtures as they are, by their text: a
// regular expression per form, nothing interpreted.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { listCases, type FixtureCase } from '../fixtures/build.js';
import { CONTRACT_JS_RUNNERS, contractCases, type ContractCase, type ContractRunner } from '../src/rules/guarantee.js';

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PACKAGES: Record<ContractRunner, string> = { vitest: 'vitest', jest: '@jest/globals', playwright: '@playwright/test', 'node:test': 'node:test', pytest: 'pytest', unittest: 'unittest' };

/**
 * The root of the case's form is the runner's in the file: imported from it by name (JS: a static import, or for Jest,
 * which runs no ES module untransformed, a destructuring of `require('@jest/globals')`; Python: `import pytest`,
 * `import unittest`, `from unittest import <member>`), the context a test callback's parameter (`(ctx) =>`, declared nowhere
 * else in the file) or `self`
 * in a `unittest.TestCase`, or (Jest's globals) not imported and not declared in the file; and the root never assigned in
 * the file.
 */
function rootIsTheRunners(c: ContractCase, text: string): boolean {
  const pkg = esc(PACKAGES[c.runner]);
  if (c.lang === 'python') {
    if (c.shape === 'decorator') return new RegExp(`^\\s*from\\s+unittest\\s+import\\s+[^\\n]*\\b${esc(c.member)}\\b`, 'm').test(text) && !new RegExp(`^\\s*${esc(c.member)}\\s*=[^=]`, 'm').test(text);
    if (c.shape === 'method-call') return /^\s*import\s+unittest\s*$/m.test(text) && /\(\s*unittest\.TestCase\s*\)/.test(text);
    return new RegExp(`^\\s*import\\s+${pkg}\\s*$`, 'm').test(text) && !new RegExp(`^\\s*${pkg}\\s*=[^=]`, 'm').test(text);
  }
  const named = (root: string): boolean =>
    new RegExp(`import\\s*\\{[^}]*\\b${esc(root)}\\b[^}]*\\}\\s*from\\s*['"]${pkg}['"]`).test(text) ||
    (c.runner === 'jest' && new RegExp(`(?:const|let|var)\\s*\\{[^}]*\\b${esc(root)}\\b[^}]*\\}\\s*=\\s*require\\(\\s*['"]${pkg}['"]\\s*\\)`).test(text));
  const unassigned = (root: string): boolean => !new RegExp(`(?<![\\w$.])${esc(root)}(?:\\.[\\w$.]+)?\\s*=(?!=)`).test(text);
  const root = c.written.split('.')[0]!;
  // Jest's globals: no import of the runner in the file, and the root declared and assigned nowhere in it.
  if (c.binding === 'global') {
    const declared = new RegExp(`(?:const|let|var|function|class)\\s+(?:[{\\[][^}\\]]*\\b${esc(root)}\\b[^}\\]]*[}\\]]|${esc(root)}\\b)|^\\s*import\\b[^;\\n]*\\b${esc(root)}\\b`, 'm');
    return !new RegExp(pkg).test(text) && !declared.test(text) && unassigned(root);
  }
  if (c.shape === 'option') return ['test', 'it'].some((r) => named(r) && unassigned(r));
  if (c.shape === 'context') {
    // The context parameter at its position: first (`(ctx) =>`), or second after the fixtures (`({}, testInfo) =>`).
    const param = CONTRACT_JS_RUNNERS.find((r) => r.runner === c.runner)?.context?.param ?? 0;
    const params = param === 0 ? `\\(\\s*${esc(root)}\\s*\\)` : `\\(\\s*\\{[^}]*\\}\\s*,\\s*${esc(root)}\\s*\\)`;
    return new RegExp(`${params}\\s*=>`).test(text) && !new RegExp(`(?:const|let|var|function)\\s+${esc(root)}\\b`).test(text) && ['test', 'it'].some((r) => named(r) && unassigned(r));
  }
  return named(root) && unassigned(root);
}

/** A use of `callee` as the case uses its form. */
function usePattern(c: ContractCase, callee: string): RegExp {
  const name = c.form === 'alias' ? `(?:${callee})` : esc(callee);
  switch (c.use) {
    case 'decorator':
      return new RegExp(`^\\s*@${name}\\b`);
    case 'raise':
      return new RegExp(`\\braise\\s+${name}\\b`);
    case 'option':
      return new RegExp(`[{,]\\s*${esc(c.member)}\\s*:\\s*\\S`);
    case 'call':
      // Playwright's `test.skip` declares a test with a title, and is an annotation without one.
      if (c.runner === 'playwright' && c.shape === 'test') return new RegExp(`(?<![.\\w$])${name}\\s*\\(\\s*['"\`]`);
      if (c.runner === 'playwright' && c.shape === 'annotation') return new RegExp(`(?<![.\\w$])${name}\\s*\\(\\s*(?:\\)|[^'"\`\\s])`);
      return new RegExp(`(?<![.\\w$])${name}\\s*\\(`);
  }
}

/** The definition of a simple alias of the case's member: a plain declaration or assignment, alone on its line. */
function aliasDefinition(c: ContractCase): RegExp {
  return c.lang === 'js'
    ? new RegExp(`^\\s*(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${esc(c.written)}\\s*;?\\s*$`)
    : new RegExp(`^\\s*([A-Za-z_]\\w*)\\s*=\\s*${esc(c.written)}\\s*$`);
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

interface Side {
  path: string;
  lines: string[];
}

const sides = new Map<string, { base: Map<string, string[]>; head: Side[] }>();
function read(fx: FixtureCase): { base: Map<string, string[]>; head: Side[] } {
  let s = sides.get(fx.id);
  if (!s) {
    const side = (name: string): Side[] => files(join(fx.dir, name)).map((f) => ({ path: relative(join(fx.dir, name), f).split('\\').join('/'), lines: readFileSync(f, 'utf8').split(/\r?\n/) }));
    s = { base: new Map(side('base').map((x) => [x.path, x.lines])), head: side('head') };
    sides.set(fx.id, s);
  }
  return s;
}

/** The fixtures (`id:line`) that carry a combination. */
export function carriers(c: ContractCase, fixtures: readonly FixtureCase[] = listCases()): string[] {
  const out: string[] = [];
  for (const fx of fixtures) {
    if (fx.runner !== c.runner || !fx.runnerEvidence || fx.outsideAssumption) continue;
    const { base, head } = read(fx);
    for (const file of head) {
      const text = file.lines.join('\n');
      if (!rootIsTheRunners(c, text)) continue;
      let use = usePattern(c, c.written);
      if (c.form === 'alias') {
        const def = aliasDefinition(c);
        const names = file.lines.map((l) => def.exec(l)?.[1]).filter((n): n is string => n !== undefined);
        if (names.length === 0) continue;
        use = usePattern(c, names.map(esc).join('|'));
      }
      const atBase = new Set(base.get(file.path) ?? []);
      file.lines.forEach((line, i) => {
        if (atBase.has(line) || !use.test(line)) return;
        const found = fx.expect.findings.some((f) => f.file === file.path && f.line === i + 1 && (f.rule === 'TG002' || f.rule === 'TG003') && (f.severity === 'warn' || f.severity === 'fail'));
        if (found) out.push(`${fx.id}:${i + 1}`);
      });
    }
  }
  return out;
}

/** Every combination of the guarantee with the fixtures that carry it. */
export function contractCoverage(): Array<{ c: ContractCase; carriers: string[] }> {
  const fixtures = listCases();
  return contractCases().map((c) => ({ c, carriers: carriers(c, fixtures) }));
}
