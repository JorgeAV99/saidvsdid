// Context for TG001 (docs/rules.md, TG001), never a verdict: whether a removed test used local code — names imported
// from the repository's own modules — that changed or is gone in this PR, its module deleted or the name no longer
// defined in it. The code may survive under another name or in another path (a rename, a move git does not detect), so
// it says nothing about what the test checked: TG001 keeps its severity and adds one sentence for the reviewer.
//
// Read by the file's text: only imports whose module the repository holds at base count as local (a package, the
// standard library, an alias the reader cannot resolve are not local); a name counts as used when it appears in the
// test's body as a whole word; a module whose exports cannot be read with certainty (`export *`, `module.exports =
// <not a literal>`, `from x import *`) keeps all its names. A test that uses no local name, or one local name that
// survives, gets no sentence.
import type { TestCase } from '../parse/index.js';
import type { CheckContext } from './types.js';

/** One local name a test file imports: the local binding, the module it comes from (base path), and the exported name. */
interface LocalImport {
  local: string;
  module: string;
  /** The exported name; '*' for a namespace or module import (its members are read at use), 'default' for a default import. */
  imported: string;
}

const JS_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs'];

const dirname = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** `a/b/../c/./d` → `a/c/d`; null when it climbs above the repository. */
function normalize(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

function exists(ctx: CheckContext, side: 'base' | 'head', path: string): boolean {
  return ctx.repo.read(side, path) !== null;
}

/** A relative JS/TS specifier resolved to a file the repository holds at base (`./x`, `../x.js` for `x.ts`, `./dir` for its index). */
function resolveJs(ctx: CheckContext, from: string, spec: string): string | null {
  const bare = spec.replace(/[?#].*$/, '');
  const target = normalize(`${dirname(from)}/${bare}`);
  if (target === null) return null;
  const stems = [target, target.replace(/\.(?:[cm]?js|jsx)$/, '')];
  for (const stem of stems) for (const ext of JS_EXTENSIONS) if (exists(ctx, 'base', stem + ext)) return stem + ext;
  return null;
}

/** A Python module resolved to a file the repository holds at base: relative to the file, or by its dotted path (from the root, `src/`, or one unique place). */
function resolvePy(ctx: CheckContext, from: string, module: string): string | null {
  const dots = /^\.*/.exec(module)![0].length;
  const rest = module.slice(dots).split('.').filter(Boolean).join('/');
  const candidates = (dir: string): string[] => (rest === '' ? [`${dir}/__init__.py`] : [`${dir}/${rest}.py`, `${dir}/${rest}/__init__.py`]).map((p) => normalize(p) ?? '');
  if (dots > 0) {
    let dir = dirname(from);
    for (let i = 1; i < dots; i++) dir = dirname(dir);
    return candidates(dir).find((p) => p !== '' && exists(ctx, 'base', p)) ?? null;
  }
  for (const root of ['', 'src']) {
    const found = candidates(root).find((p) => p !== '' && exists(ctx, 'base', p));
    if (found) return found;
  }
  // A package below some directory (a `pythonpath` the reader does not read): only when exactly one file matches.
  const all = ctx.repo.list('base');
  if (!all || rest === '') return null;
  const ends = [`/${rest}.py`, `/${rest}/__init__.py`];
  const matches = all.filter((p) => ends.some((e) => p.endsWith(e)));
  return matches.length === 1 ? matches[0]! : null;
}

const word = (name: string): RegExp => new RegExp(`(?<![\\w$])${name.replace(/[$]/g, '\\$')}(?![\\w$])`);

/** The local names a JS/TS test file imports. */
function jsImports(ctx: CheckContext, path: string, source: string): LocalImport[] {
  const out: LocalImport[] = [];
  const add = (spec: string, bindings: Array<[string, string]>): void => {
    if (!spec.startsWith('.')) return;
    const module = resolveJs(ctx, path, spec);
    if (!module) return;
    for (const [local, imported] of bindings) out.push({ local, module, imported });
  };
  const named = (list: string): Array<[string, string]> =>
    list.split(',').map((s) => s.trim().replace(/^type\s+/, '')).filter(Boolean).map((s) => {
      const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
      return m ? ([m[2] ?? m[1]!, m[1]!] as [string, string]) : (['', ''] as [string, string]);
    }).filter(([l]) => l !== '');
  for (const m of source.matchAll(/import\s+(?!type\s)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = m[1]!.trim();
    const bindings: Array<[string, string]> = [];
    const ns = /\*\s+as\s+([\w$]+)/.exec(clause);
    if (ns) bindings.push([ns[1]!, '*']);
    const braces = /\{([\s\S]*?)\}/.exec(clause);
    if (braces) bindings.push(...named(braces[1]!));
    const def = /^([\w$]+)\s*(?:,|$)/.exec(clause);
    if (def) bindings.push([def[1]!, 'default']);
    add(m[2]!, bindings);
  }
  for (const m of source.matchAll(/(?:const|let|var)\s+(\{[\s\S]*?\}|[\w$]+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const target = m[1]!;
    add(m[2]!, target.startsWith('{') ? named(target.slice(1, -1).replace(/:\s*/g, ' as ')) : [[target, '*']]);
  }
  return out;
}

/** The local names a Python test file imports. */
function pyImports(ctx: CheckContext, path: string, source: string): LocalImport[] {
  const out: LocalImport[] = [];
  const joined = source.replace(/\(\s*([^)]*?)\s*\)/g, (_m, inner: string) => inner.replace(/\s+/g, ' '));
  for (const line of joined.split('\n')) {
    const from = /^\s*from\s+([\w.]+)\s+import\s+(.+?)\s*(?:#.*)?$/.exec(line);
    if (from) {
      if (from[2]!.trim() === '*') continue;
      const module = resolvePy(ctx, path, from[1]!);
      for (const part of from[2]!.split(',').map((s) => s.trim()).filter(Boolean)) {
        const m = /^(\w+)(?:\s+as\s+(\w+))?$/.exec(part);
        if (!m) continue;
        // `from pkg import mod` may import a submodule: then the name is the module itself.
        const sub = module ? resolvePy(ctx, path, `${from[1]!}${from[1]!.endsWith('.') ? '' : '.'}${m[1]!}`) : null;
        if (sub) out.push({ local: m[2] ?? m[1]!, module: sub, imported: '*' });
        else if (module) out.push({ local: m[2] ?? m[1]!, module, imported: m[1]! });
      }
      continue;
    }
    const imp = /^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?\s*(?:#.*)?$/.exec(line);
    if (imp) {
      const module = resolvePy(ctx, path, imp[1]!);
      if (module) out.push({ local: imp[2] ?? imp[1]!, module, imported: '*' });
    }
  }
  return out;
}

/** Whether `name` is still exported by (JS) or defined in (Python) the head side of `module`; true when it cannot be told. */
function stillThere(ctx: CheckContext, module: string, name: string): boolean {
  const change = ctx.allChanges.find((c) => c.basePath === module);
  const headPath = change ? change.headPath : module;
  if (headPath === null) return false;
  const text = ctx.repo.read('head', headPath);
  if (text === null) return false;
  if (name === '*') return true;
  const n = name.replace(/[$]/g, '\\$');
  if (module.endsWith('.py')) {
    if (/^\s*from\s+\S+\s+import\s+\*/m.test(text)) return true;
    return new RegExp(`^(?:(?:async\\s+)?def|class)\\s+${n}\\b|^${n}\\s*(?::[^=]*)?=|^\\s*(?:from\\s+\\S+\\s+)?import\\s+.*\\b${n}\\b`, 'm').test(text);
  }
  if (/^\s*export\s+\*/m.test(text) || /module\.exports\s*=\s*(?!\{)/.test(text)) return true;
  if (name === 'default') return /\bexport\s+default\b|module\.exports\s*=/.test(text);
  return new RegExp(
    `\\bexport\\s+(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|enum|interface|type|abstract\\s+class)\\s+${n}\\b` +
      `|\\bexport\\s*\\{[^}]*\\b${n}\\b[^}]*\\}|\\bexports\\.${n}\\b|module\\.exports\\s*=\\s*\\{[^}]*\\b${n}\\b`,
  ).test(text);
}

/** The local names each base test file imports, read once per file. */
export type ImportCache = Map<string, LocalImport[]>;

/**
 * Whether `test`, removed from `file` (base path), used at least one local name and every local name it uses is no
 * longer in its base module at head. Context only: the code may survive elsewhere.
 */
export function localCodeChanged(ctx: CheckContext, file: string, test: TestCase, cache: ImportCache): boolean {
  let imports = cache.get(file);
  if (!imports) {
    const source = ctx.repo.read('base', file) ?? '';
    imports = file.endsWith('.py') ? pyImports(ctx, file, source) : jsImports(ctx, file, source);
    cache.set(file, imports);
  }
  let used = 0;
  for (const imp of imports) {
    if (!word(imp.local).test(test.body)) continue;
    // A namespace or module import: each member the test reads is a name of its own.
    const members = imp.imported === '*' ? [...test.body.matchAll(new RegExp(`(?<![\\w$])${imp.local.replace(/[$]/g, '\\$')}\\.([\\w$]+)`, 'g'))].map((m) => m[1]!) : [imp.imported];
    for (const name of members.length > 0 ? members : ['*']) {
      used++;
      if (stillThere(ctx, imp.module, name)) return false;
    }
  }
  return used > 0;
}
