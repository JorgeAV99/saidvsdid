// Where a run or an edit happened: ubicar es certeza o no es.
//
// A path counts for the repository under review only when exact,
// deterministic resolution proves which of its files it is. Anything that
// would need a guess leaves it UNPLACED: a relative path with no known
// working directory, an absolute path outside the repository's root (no
// matching by suffix), a spelling that names one file on a case-sensitive
// file system and another on a case-insensitive one, a `..` after something
// that is not a known directory, a symlink or a submodule on the way (in base
// or in head). Rules treat an unplaced edit as uncertain and an unplaced run's
// result as unknown: it is never stated as a fact.

/** One side of the repository (base or head): its files, symlinks and submodules, repo-relative. */
export interface Tree {
  files: ReadonlySet<string>;
  symlinks: ReadonlySet<string>;
  submodules: ReadonlySet<string>;
}

/** What is known of the repository: its trees at base and head (none: nothing is known). */
export interface RepoModel {
  trees: readonly Tree[];
}

export const EMPTY_MODEL: RepoModel = { trees: [] };

interface Index {
  dirs: Set<string>;
  /** Directory ('' is the root) → the names in it. */
  children: Map<string, Set<string>>;
  stops: Set<string>;
}

const indexes = new WeakMap<Tree, Index>();
const EMPTY_TREE: Tree = { files: new Set(), symlinks: new Set(), submodules: new Set() };

function indexOf(tree: Tree): Index {
  let ix = indexes.get(tree);
  if (ix) return ix;
  ix = { dirs: new Set(['']), children: new Map(), stops: new Set([...tree.symlinks, ...tree.submodules]) };
  for (const entry of [...tree.files, ...tree.symlinks, ...tree.submodules]) {
    const segs = entry.split('/');
    for (let k = 1; k <= segs.length; k++) {
      const parent = segs.slice(0, k - 1).join('/');
      if (k < segs.length) ix.dirs.add(segs.slice(0, k).join('/'));
      let names = ix.children.get(parent);
      if (!names) ix.children.set(parent, (names = new Set()));
      names.add(segs[k - 1]!);
    }
  }
  indexes.set(tree, ix);
  return ix;
}

/**
 * A name in the closed set of characters every system and shell reads the
 * same way: letters, digits, `.`, `_` and `-` (widened only with data). Any
 * other character — spaces, brackets and `*?` (wildcards in PowerShell paths),
 * `:` (a stream on Windows), `~` (short names), unicode, control characters —
 * is outside. Within the set, Windows still drops a trailing dot (`docs.` is
 * `docs`) and maps reserved device names (`NUL`, `CON`, `COM1`, with any
 * extension) to devices: outside too.
 */
export function ordinaryName(name: string): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.endsWith('.')) return false;
  return !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i.test(name);
}

/**
 * Resolves repo-relative components in one tree, the POSIX way (one
 * component at a time), on a case-sensitive or a case-insensitive file
 * system. null: the result depends on something that is not known.
 */
function walk(tree: Tree, insensitive: boolean, comps: readonly string[]): string | null {
  const ix = indexOf(tree);
  const stack: string[] = [];
  for (const c of comps) {
    if (c === '' || c === '.') continue;
    if (c === '..') {
      // `x/..` is the parent of x only if x is a directory; above the root is outside.
      if (!stack.length || !ix.dirs.has(stack.join('/'))) return null;
      stack.pop();
      continue;
    }
    // A name that is not ordinary on every OS may be another file on one of them.
    if (!ordinaryName(c)) return null;
    let name = c;
    if (insensitive) {
      const lower = c.toLowerCase();
      const matches = [...(ix.children.get(stack.join('/')) ?? [])].filter((n) => n.toLowerCase() === lower);
      // Two names that differ only in case cannot both be there: which one is, is not known.
      if (matches.length > 1) return null;
      if (matches.length === 1) name = matches[0]!;
    }
    stack.push(name);
    // A symlink points wherever the working tree said at the time; a submodule is another repository.
    if (ix.stops.has(stack.join('/'))) return null;
  }
  // Evidence writes repository paths with `/`: a name holding a `\` (legal on POSIX) cannot be written unambiguously.
  return stack.some((n) => n.includes('\\')) ? null : stack.join('/');
}

/**
 * Repo-relative components → the repository path they name with certainty
 * ('' for the root), or null: every tree, on a case-sensitive and on a
 * case-insensitive file system, must resolve them to the same path.
 */
export function resolveInRepo(comps: readonly string[], model: RepoModel): string | null {
  const trees = model.trees.length ? model.trees : [EMPTY_TREE];
  let found: string | null = null;
  for (const tree of trees) {
    for (const insensitive of [false, true]) {
      const r = walk(tree, insensitive, comps);
      if (r === null || (found !== null && r !== found)) return null;
      found = r;
    }
  }
  return found;
}

/** An absolute path, split: its root and the components after it. */
interface Absolute {
  /** `C:` (a drive, upper-cased), `/`, or a marker such as `<REPO>`. */
  root: string;
  comps: string[];
}

/** A drive letter, or the recording marker written from one: `\` separates there. */
const WINDOWS = /^(?:[A-Za-z]:[\\/]|<[A-Z]+>\\)/;

export const isWindowsPath = (p: string): boolean => WINDOWS.test(p);

/** Components of a path as written. `\` is a separator only on a Windows path; elsewhere it is part of a name. */
function components(p: string, windows: boolean): string[] {
  return (windows ? p.split(/[\\/]/) : p.split('/')).filter((c) => c !== '' && c !== '.');
}

/** An absolute path, or null when it is not one (relative, or a root saidvsdid cannot read: `\\server`, `C:x`). */
function absolute(p: string): Absolute | null {
  const drive = /^([A-Za-z]):[\\/]/.exec(p);
  if (drive) return { root: `${drive[1]!.toUpperCase()}:`, comps: components(p.slice(2), true) };
  const marker = /^(<[A-Z]+>)(?=[\\/]|$)/.exec(p);
  if (marker) return { root: marker[1]!, comps: components(p.slice(marker[1]!.length), p[marker[1]!.length] === '\\') };
  if (p.startsWith('/') && !p.startsWith('//')) return { root: '/', comps: components(p, false) };
  return null;
}

export const isAbsolutePath = (p: string): boolean => absolute(p) !== null || /^(?:[\\/]{2}|[A-Za-z]:(?![\\/])|\\)/.test(p);

/**
 * A working directory: known, or unknown with the reason why. It is never
 * defaulted to another one: an unknown directory stays unknown.
 */
export type Cwd = { kind: 'known'; path: string } | { kind: 'unknown'; why: string };
export const knownCwd = (path: string): Cwd => ({ kind: 'known', path });
export const unknownCwd = (why: string): Cwd => ({ kind: 'unknown', why });
/** Why a session's directory is unknown when its format does not record one (what `--cwd` may supply). */
export const NOT_RECORDED = 'not recorded';

/**
 * The working directory after `cd dir`, from `cwd`. A
 * relative `cd` from an unknown directory, `cd -`, `cd +`, an option, `cd ~` or a variable stay
 * unknown.
 */
export function changeDir(cwd: Cwd, dir: string): Cwd {
  // `-` and `+` walk the location history (bash's `cd -`, PowerShell 7's `cd -`/`cd +`); a leading `-` is an option.
  if (!dir || /^[-+~$%]/.test(dir)) return unknownCwd(`cd ${dir}`);
  if (absolute(dir)) return knownCwd(dir);
  // Absolute in a way saidvsdid does not read (`\\server`, `C:x`, a rooted `\dir` on the current drive): never relative.
  if (isAbsolutePath(dir)) return unknownCwd(`cd ${dir}`);
  if (cwd.kind === 'unknown') return cwd;
  if (!absolute(cwd.path)) return unknownCwd('relative to a relative directory');
  return knownCwd(`${cwd.path.replace(/[\\/]+$/, '')}${isWindowsPath(cwd.path) ? '\\' : '/'}${dir}`);
}

/** Resolves paths the agent used against the repository under review. */
export class Locator {
  private readonly roots: Absolute[];

  /** `roots`: the repository's absolute paths (the `<REPO>` marker of recorded sessions is always one). */
  constructor(roots: readonly (string | null | undefined)[], readonly model: RepoModel = EMPTY_MODEL) {
    this.roots = [...roots, '<REPO>'].flatMap((r) => (r ? [absolute(r)].filter((a): a is Absolute => a !== null) : []));
  }

  /**
   * The repo-relative path `path` names ('' for the root), resolved from the
   * working directory `cwd`, or null when it is unplaced.
   */
  locate(path: string, cwd: Cwd): string | null {
    let abs = absolute(path);
    if (!abs) {
      if (isAbsolutePath(path) || cwd.kind === 'unknown') return null;
      const base = absolute(cwd.path);
      if (!base) return null;
      abs = { root: base.root, comps: [...base.comps, ...components(path, isWindowsPath(cwd.path))] };
    }
    for (const root of this.roots) {
      if (root.root !== abs.root || abs.comps.length < root.comps.length) continue;
      // The root's own components, exactly as written: no case folding, no `..`.
      if (!root.comps.every((c, i) => abs!.comps[i] === c)) continue;
      return resolveInRepo(abs.comps.slice(root.comps.length), this.model);
    }
    return null;
  }

  /** The repo-relative directory a working directory names ('' for the root), or null when it is unknown or unplaced. */
  locateDir(cwd: Cwd): string | null {
    return cwd.kind === 'known' ? this.locate(cwd.path, unknownCwd('an absolute directory needs none')) : null;
  }

  /** See inRepo. */
  inRepo(path: string): string | null {
    return inRepo(path, this.model);
  }
}

/**
 * A repo-relative path, as evidence records it (`/`-separated), resolved in
 * the model ('' for the root); null when unplaced. A `\` is a separator on
 * Windows and part of a name elsewhere: which one is not known, so unplaced.
 */
export function inRepo(path: string, model: RepoModel): string | null {
  if (isAbsolutePath(path) || path.startsWith('<') || path.includes('\\')) return null;
  return resolveInRepo(components(path, false), model);
}
