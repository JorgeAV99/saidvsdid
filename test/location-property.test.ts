// Locating paths against a brute-force oracle: "ubicar es certeza o no es".
//
// Random model repositories (directories, files, symlinks and submodules in
// base and in head, names that collide by case, other checkouts whose files
// share suffixes with the repository's) and random paths (absolute and
// relative, `.`, `..`, `\`, case variants, a working directory that is known,
// unknown or elsewhere, `cd` in the command). The oracle builds each tree as
// nested nodes and resolves the path the POSIX way, one component at a time,
// on a case-sensitive and on a case-insensitive file system, in base and in
// head. The path is placed in a file of the repository only when every one of
// those resolutions reaches that same file; anything that would need what the
// trees do not say (a symlink's target, a submodule's content, what `x/..` is
// when x is not a known directory, which of two names differing only in case
// is there, anything above the root) leaves it unplaced. src/location.ts must
// agree exactly, on thousands of cases with a fixed seed, and every class must
// occur often.
import { describe, expect, it } from 'vitest';
import { changeDir, knownCwd, Locator, unknownCwd, type Cwd, type RepoModel, type Tree } from '../src/location.js';

const NONE: Cwd = unknownCwd('none');
const pathOf = (c: Cwd): string | null => (c.kind === 'known' ? c.path : null);

type Node = { kind: 'dir'; children: Map<string, Node> } | { kind: 'file' } | { kind: 'symlink' } | { kind: 'submodule' };
type Why = 'placed' | 'cwd-unknown' | 'outside' | 'suffix-collision' | 'symlink' | 'submodule' | 'case' | 'dotdot' | 'above-root' | 'backslash-name' | 'not-ordinary';

/** mulberry32. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['src', 'Src', 'docs', 'DOCS', 'test', 'lib', 'tmp', 'a.js', 'A.js', 'b.ts', 'link', 'sub', 'README.md', 'readme.md'];
// Names Windows reads differently from POSIX: a trailing dot or space, a stream, a device, a short name, control characters.
const ODD_NAMES = ['docs.', 'src ', 'a.js.', 'a:b', 'nul', 'NUL.txt', 'con', 'Com1.js', 'lpt9', 'DOCS~1', 'PROGRA~2', 'sub[1]', 'my docs', 'caf\u00e9', 'a+b', 'x@y', 'tab\tname', 'q?', 'pipe|x', 'star*'];

/** The oracle's own reading of an ordinary name: only letters, digits, `.`, `_` and `-` (Microsoft's naming rules for the rest). */
function ordinaryEverywhere(name: string): boolean {
  if (name.endsWith('.') || name.endsWith(' ')) return false;
  for (const ch of name) if (!'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-'.includes(ch)) return false;
  for (const ch of name) if (ch.charCodeAt(0) < 32 || ':<>"|?*\\'.includes(ch)) return false;
  if (/~[0-9]/.test(name)) return false;
  const stem = name.split('.')[0]!.toUpperCase();
  return !['CON', 'PRN', 'AUX', 'NUL', ...[1, 2, 3, 4, 5, 6, 7, 8, 9, '¹', '²', '³'].flatMap((n) => [`COM${n}`, `LPT${n}`])].includes(stem);
}

function randomDir(next: () => number, depth: number): Map<string, Node> {
  const children = new Map<string, Node>();
  const n = 1 + Math.floor(next() * 4);
  for (let i = 0; i < n; i++) {
    const name = NAMES[Math.floor(next() * NAMES.length)]!;
    if (children.has(name)) continue;
    const r = next();
    children.set(name, depth < 3 && r < 0.4 ? { kind: 'dir', children: randomDir(next, depth + 1) } : r < 0.75 ? { kind: 'file' } : r < 0.9 ? { kind: 'symlink' } : { kind: 'submodule' });
  }
  return children;
}

/** Head: base with a few entries changed (removed, added, turned into a symlink or a directory). */
function mutate(next: () => number, dir: Map<string, Node>): Map<string, Node> {
  const out = new Map<string, Node>();
  for (const [name, node] of dir) {
    const r = next();
    if (r < 0.08) continue;
    if (r < 0.14) out.set(name, { kind: 'symlink' });
    else out.set(name, node.kind === 'dir' ? { kind: 'dir', children: mutate(next, node.children) } : node);
  }
  if (next() < 0.2) {
    const name = NAMES[Math.floor(next() * NAMES.length)]!;
    if (!out.has(name)) out.set(name, next() < 0.5 ? { kind: 'file' } : { kind: 'dir', children: randomDir(next, 2) });
  }
  return out;
}

/** The nested tree as src/location.ts receives it: repo-relative paths by kind. */
function flatten(dir: Map<string, Node>, prefix = '', out: Tree = { files: new Set(), symlinks: new Set(), submodules: new Set() }): Tree {
  for (const [name, node] of dir) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (node.kind === 'dir') {
      if (node.children.size) flatten(node.children, p, out);
      else (out.files as Set<string>).add(`${p}/.keep`); // git keeps no empty directory
    } else if (node.kind === 'file') (out.files as Set<string>).add(p);
    else if (node.kind === 'symlink') (out.symlinks as Set<string>).add(p);
    else (out.submodules as Set<string>).add(p);
  }
  return out;
}
const withKeeps = (dir: Map<string, Node>): Map<string, Node> =>
  new Map([...dir].map(([n, node]) => [n, node.kind === 'dir' ? { kind: 'dir', children: node.children.size ? withKeeps(node.children) : new Map([['.keep', { kind: 'file' } as Node]]) } : node]));

/** The oracle: one tree, one file system, one component at a time. */
function resolve(root: Map<string, Node>, insensitive: boolean, comps: readonly string[]): { path: string } | { why: Why } {
  const names: string[] = [];
  const nodes: (Node | undefined)[] = [];
  let here: Node | undefined = { kind: 'dir', children: root };
  for (const c of comps) {
    if (c === '.' || c === '') continue;
    if (c === '..') {
      if (!names.length) return { why: 'above-root' };
      if (here?.kind !== 'dir') return { why: 'dotdot' };
      names.pop();
      nodes.pop();
      here = nodes.length ? nodes[nodes.length - 1] : { kind: 'dir', children: root };
      continue;
    }
    if (!ordinaryEverywhere(c)) return { why: c.includes('\\') ? 'backslash-name' : 'not-ordinary' };
    let name = c;
    let child: Node | undefined;
    if (here?.kind === 'dir') {
      const matches = [...here.children.keys()].filter((n) => (insensitive ? n.toLowerCase() === c.toLowerCase() : n === c));
      if (matches.length > 1) return { why: 'case' };
      if (matches.length === 1) {
        name = matches[0]!;
        child = here.children.get(name);
      }
    }
    if (child?.kind === 'symlink') return { why: 'symlink' };
    if (child?.kind === 'submodule') return { why: 'submodule' };
    names.push(name);
    nodes.push(child);
    here = child;
  }
  return { path: names.join('/') };
}

interface Repo {
  base: Map<string, Node>;
  head: Map<string, Node>;
  model: RepoModel;
}

function oraclePlace(repo: Repo, comps: readonly string[]): { path: string } | { why: Why } {
  const found: string[] = [];
  for (const tree of [repo.base, repo.head]) {
    for (const insensitive of [false, true]) {
      const r = resolve(tree, insensitive, comps);
      if ('why' in r) return r;
      found.push(r.path);
    }
  }
  // Resolutions differ only in case (a name exists in one tree and not the other, or with another spelling).
  if (new Set(found).size > 1) return { why: 'case' };
  // Evidence records repo paths with `/`: a name holding a `\` cannot be written unambiguously.
  if (found[0]!.includes('\\')) return { why: 'backslash-name' };
  return { path: found[0]! };
}

// An absolute path, structured: a root and components.
interface Abs {
  root: 'C:' | 'c:' | '/' | '<REPO>';
  comps: string[];
}
const REPO_ROOTS: Record<'win' | 'posix', Abs> = { win: { root: 'C:', comps: ['work', 'repo'] }, posix: { root: '/', comps: ['home', 'u', 'repo'] } };
const ROOT_STRINGS = ['C:/work/repo', '/home/u/repo'];

function render(a: Abs, next: () => number): string {
  const win = a.root !== '/' && !(a.root === '<REPO>' && next() < 0.5);
  const sep = win ? (next() < 0.7 ? '\\' : '/') : '/';
  const head = a.root === '/' ? '' : a.root;
  return `${head}${a.root === '/' ? '/' : sep}${a.comps.join(sep)}`;
}

/** What the oracle says of an absolute path: under one of the repository's roots, or outside. */
function oracleAbsolute(repo: Repo, a: Abs, rendered: string): { path: string } | { why: Why } {
  // A drive letter, or the recording marker written with `\`: a Windows path.
  const win = /^(?:[A-Za-z]:[\\/]|<[A-Z]+>\\)/.test(rendered);
  // On a POSIX path `\` is part of a name; on a Windows one it separates.
  const comps = win ? a.comps.flatMap((c) => c.split('\\')) : a.comps;
  const roots: Abs[] = [REPO_ROOTS.win, REPO_ROOTS.posix, { root: '<REPO>', comps: [] }];
  for (const root of roots) {
    const sameRoot = root.root.toUpperCase() === a.root.toUpperCase() && (root.root === '<REPO>') === (a.root === '<REPO>');
    if (!sameRoot || comps.length < root.comps.length) continue;
    // Outside the repository nothing is known: its own components must be exactly the root's.
    const prefix = comps.slice(0, root.comps.length).filter((c) => c !== '.' && c !== '');
    const kept = comps.filter((c) => c !== '.' && c !== '');
    if (!root.comps.every((c, i) => kept[i] === c)) continue;
    void prefix;
    return oraclePlace(repo, kept.slice(root.comps.length));
  }

  // Another checkout whose tail names a file of the repository: still outside.
  const tail = comps.slice(-2).join('/');
  return { why: [...flatten(repo.base).files].some((f) => f.endsWith(tail)) ? 'suffix-collision' : 'outside' };
}

const pick = <T,>(next: () => number, xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;

/** A random component: a name of the trees (in some case), `.`, `..`, or a name with `\` in it. */
function component(next: () => number): string {
  const r = next();
  if (r < 0.12) return '..';
  if (r < 0.17) return '.';
  if (r < 0.22) return `${pick(next, NAMES)}\\${pick(next, NAMES)}`;
  if (r < 0.28) return pick(next, ODD_NAMES);
  const n = pick(next, NAMES);
  return next() < 0.15 ? n.toUpperCase() : n;
}

function randomRepo(next: () => number): Repo {
  const base = randomDir(next, 0);
  const head = mutate(next, base);
  return { base: withKeeps(base), head: withKeeps(head), model: { trees: [flatten(base), flatten(head)] } };
}

describe('locating paths against a brute-force oracle', () => {
  it('absolute and relative paths, from a known, unknown or outside working directory, with cd', () => {
    const next = rng(20261002);
    const broken: string[] = [];
    const seen = new Map<Why, number>();
    for (let i = 0; i < 6000; i++) {
      const repo = randomRepo(next);
      const locator = new Locator(ROOT_STRINGS, repo.model);
      const style = pick(next, ['win', 'posix', 'marker'] as const);
      const root: Abs = style === 'marker' ? { root: '<REPO>', comps: [] } : { ...REPO_ROOTS[style], root: style === 'win' && next() < 0.2 ? 'c:' : REPO_ROOTS[style].root };
      const comps = Array.from({ length: 1 + Math.floor(next() * 4) }, () => component(next));
      let want: { path: string } | { why: Why };
      let got: string | null;
      const kind = next();
      if (kind < 0.35) {
        // An absolute path: under the root, or under another checkout (a suffix of the repository's files, or not).
        const elsewhere = next() < 0.3;
        const outsideComps = [...root.comps.slice(0, -1), next() < 0.5 ? 'other-checkout' : 'Repo'];
        const a: Abs = { root: root.root, comps: elsewhere ? [...outsideComps, ...(next() < 0.6 ? [...flatten(repo.base).files][0]?.split('/') ?? comps : comps)] : [...root.comps, ...comps] };
        const s = render(a, next);
        want = oracleAbsolute(repo, a, s);
        got = locator.locate(s, NONE);
      } else {
        // A relative path from a working directory reached by `cd`s: known (inside or outside), or unknown.
        const known = next();
        let cwd: Abs | null = known < 0.15 ? null : known < 0.3 ? { root: root.root, comps: [...root.comps.slice(0, -1), 'elsewhere'] } : { root: root.root, comps: [...root.comps] };
        let cwdV: Cwd = cwd ? knownCwd(render(cwd, next)) : NONE;
        const cds = Math.floor(next() * 3);
        for (let k = 0; k < cds; k++) {
          const r = next();
          if (r < 0.1) {
            cwd = null;
            cwdV = changeDir(cwdV, pick(next, ['-', '~/x', '$HOME', '+']));
          } else if (r < 0.2) {
            cwd = { root: root.root, comps: [...root.comps] };
            cwdV = changeDir(cwdV, render(cwd, next));
          } else {
            const step = [component(next)];
            const cwdNow = pathOf(cwdV);
            const winCwd = cwd !== null && cwd.root !== '/' && cwdNow !== null && /^(?:[A-Za-z]:[\\/]|<[A-Z]+>\\)/.test(cwdNow);
            cwd = cwd ? { root: cwd.root, comps: [...cwd.comps, ...(winCwd ? step.flatMap((c) => c.split('\\')) : step)] } : null;
            cwdV = changeDir(cwdV, step[0]!);
          }
        }
        const cwdString = pathOf(cwdV);
        const sep = cwdString !== null && /^(?:[A-Za-z]:[\\/]|<[A-Z]+>\\)/.test(cwdString) && next() < 0.7 ? '\\' : '/';
        const rel = comps.join(sep);
        if (cwd === null || cwdString === null) want = { why: 'cwd-unknown' };
        else {
          const winCwd = /^(?:[A-Za-z]:[\\/]|<[A-Z]+>\\)/.test(cwdString);
          const relComps = winCwd ? rel.split(/[\\/]/) : rel.split('/');
          want = oracleAbsolute(repo, { root: cwd.root, comps: [...cwd.comps, ...relComps] }, cwdString);
        }
        got = locator.locate(rel, cwdV);
      }
      const expected = 'path' in want ? want.path : null;
      const why: Why = 'path' in want ? 'placed' : want.why;
      seen.set(why, (seen.get(why) ?? 0) + 1);
      if (got !== expected) broken.push(`#${i} ${why}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    }
    expect(broken.slice(0, 10)).toEqual([]);
    // Every class occurs often.
    for (const why of ['placed', 'cwd-unknown', 'outside', 'suffix-collision', 'symlink', 'submodule', 'case', 'dotdot', 'above-root', 'backslash-name', 'not-ordinary'] as const) {
      expect(seen.get(why) ?? 0, why).toBeGreaterThan(40);
    }
  });

  it('the cases of the review', () => {
    const tree = (files: string[], symlinks: string[] = [], submodules: string[] = []): Tree => ({ files: new Set(files), symlinks: new Set(symlinks), submodules: new Set(submodules) });
    const files = ['src/a.js', 'docs/guide.txt', 'docs/tmp/.keep', 'src/nested/.keep', 'test/a.test.js'];
    const locator = new Locator(['C:/work/repo'], { trees: [tree(files, ['docs/link'], ['vendor/sub']), tree(files, ['docs/link'], ['vendor/sub'])] });
    // F2: another checkout whose suffix is a repository file
    const at = knownCwd('C:\\work\\repo');
    expect(locator.locate('C:\\work\\other-checkout\\src\\a.js', NONE)).toBeNull();
    // F4: a case variant of a repository file, relative to a known working directory
    expect(locator.locate('DOCS/guide.txt', at)).toBeNull();
    expect(locator.locate('docs/guide.txt', at)).toBe('docs/guide.txt');
    // F5: `..` after a symlink
    expect(locator.locate('docs/tmp/../link/../a.js', at)).toBeNull();
    expect(locator.locate('docs/tmp/../guide.txt', at)).toBe('docs/guide.txt');
    // rule 2: an unknown working directory places no relative path
    expect(locator.locate('src/a.js', NONE)).toBeNull();
    // rule 1: a `cd` elsewhere, or an unknown one
    expect(locator.locateDir(changeDir(at, 'C:\\work\\other'))).toBeNull();
    expect(changeDir(NONE, 'src').kind).toBe('unknown');
    expect(locator.locateDir(changeDir(at, 'src'))).toBe('src');
    // cd -, cd + (location history), an option: unknown
    for (const d of ['-', '+', '-Path']) expect(changeDir(at, d).kind).toBe('unknown');
    // Ninth review, F7: a rooted path without a drive (the current drive's), `C:x`, `\\server\x`: never appended
    for (const d of ['\\review\\outside\\repo', 'C:x', '\\\\server\\share']) expect(changeDir(at, d).kind).toBe('unknown');
    // the drive letter is not the file system's: its case does not matter; the rest of the root's does
    expect(locator.locate('c:\\work\\repo\\src\\a.js', NONE)).toBe('src/a.js');
    expect(locator.locate('C:\\Work\\repo\\src\\a.js', NONE)).toBeNull();
  });
});
