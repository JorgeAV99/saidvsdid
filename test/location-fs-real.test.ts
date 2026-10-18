// Which file a path names, against the real file system: "the oracle is the real system".
//
// On each OS of the CI matrix, a real repository (with a directory symlink
// where the OS allows one) is written through generated paths — `.`, `..`,
// case variants, trailing dots and spaces, reserved device names, short names,
// streams — and the file that really changed is looked up. saidvsdid must
// either leave the path unplaced or name exactly that file. macOS (APFS does
// not distinguish case) and Windows (which drops trailing dots and spaces,
// maps device names) are the ones that matter. On Windows half the writes go
// through Node's fs, which uses `\\?\` paths (no Win32 normalisation: a
// `docs.` component is a directory named `docs.`), and half through cmd.exe,
// which uses the Win32 API like most programs (`docs.` is `docs`).
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Locator, unknownCwd, type RepoModel } from '../src/location.js';

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
const pick = <T,>(next: () => number, xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;

const root = mkdtempSync(join(tmpdir(), 'saidvsdid-fs-'));
afterAll(() => {
  try {
    unlinkSync(join(root, 'docs', 'link'));
  } catch {
    // no link was made, or it is a junction removed with the tree
  }
  rmSync(root, { recursive: true, force: true });
});

/** Every entry under the repository, without following links: files with their content, and links. */
function snapshot(): { files: Map<string, string>; links: Set<string> } {
  const files = new Map<string, string>();
  const links = new Set<string>();
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(p);
      if (st.isSymbolicLink()) links.add(r);
      else if (st.isDirectory()) walk(p, r);
      else files.set(r, readFileSync(p, 'utf8'));
    }
  };
  walk(root, '');
  return { files, links };
}

describe('paths against the real file system', () => {
  it('every write lands in the file saidvsdid names, or the path is unplaced', () => {
    const original: Record<string, string> = { 'src/a.js': 'a\n', 'docs/guide.txt': 'g\n', 'docs/tmp/.keep': '', 'test/a.test.js': 't\n', 'README.md': 'r\n' };
    for (const [f, text] of Object.entries(original)) {
      mkdirSync(join(root, f, '..'), { recursive: true });
      writeFileSync(join(root, f), text);
    }
    // A directory symlink docs/link → src (a junction on Windows, which needs no privilege).
    try {
      if (process.platform === 'win32') symlinkSync(join(root, 'src'), join(root, 'docs', 'link'), 'junction');
      else symlinkSync('../src', join(root, 'docs', 'link'), 'dir');
    } catch {
      // without links, the rest still applies
    }
    const start = snapshot();
    const model: RepoModel = { trees: [{ files: new Set(start.files.keys()), symlinks: start.links, submodules: new Set() }] };
    const locator = new Locator([root], model);

    const NAMES = ['src', 'SRC', 'Src', 'docs', 'DOCS', 'test', 'tmp', 'link', 'a.js', 'A.js', 'guide.txt', 'GUIDE.txt', 'README.md', 'readme.md', 'new.txt', 'New.txt'];
    const ODD = ['docs.', 'docs ', 'guide.txt.', 'a.js ', 'nul', 'NUL.txt', 'con', 'aux.js', 'DOCS~1', 'GUIDE~1.TXT', 'a:b', 'src:x'];
    const next = rng(20261004);
    const broken: string[] = [];
    const seen = { placed: 0, unplaced: 0, failed: 0 };
    // Coverage by construction, not by luck: paths that must be placed (and land in that file) or unplaced.
    const GUARANTEED: [string[], string | null][] = [
      [['src', 'a.js'], 'src/a.js'],
      [['docs', 'guide.txt'], 'docs/guide.txt'],
      [['docs', 'tmp', '..', 'guide.txt'], 'docs/guide.txt'],
      [['README.md'], 'README.md'],
      [['test', 'a.test.js'], 'test/a.test.js'],
      [['src', 'new.txt'], 'src/new.txt'],
      [['docs.', 'guide.txt'], null],
      [['DOCS~1', 'guide.txt'], null],
      [['src', 'nul'], null],
      [['src', 'a:b'], null],
      [['src', 'x', '..', 'a.js'], null],
    ];
    const got: [string, string][] = [];
    for (let i = 0; i < GUARANTEED.length + 1500; i++) {
      const g = i < GUARANTEED.length ? GUARANTEED[i]! : null;
      // A fifth of the paths aim an odd name at a real file (`docs./guide.txt`, the review's N4).
      const comps = g
        ? g[0]
        : next() < 0.2
          ? pick(next, [
              ['docs.', 'guide.txt'],
              ['docs ', 'guide.txt'],
              ['docs', 'guide.txt.'],
              ['docs', 'guide.txt '],
              ['src.', 'a.js'],
              ['src', 'a.js.'],
              ['DOCS', 'guide.txt'],
              ['docs', 'GUIDE.txt'],
              ['DOCS~1', 'guide.txt'],
              ['docs', 'tmp', '..', 'guide.txt'],
              ['docs', 'link', '..', 'README.md'],
              ['docs', 'link', 'a.js'],
            ])
          : Array.from({ length: 1 + Math.floor(next() * 4) }, () => {
              const r = next();
              return r < 0.12 ? '..' : r < 0.18 ? '.' : r < 0.32 ? pick(next, ODD) : pick(next, NAMES);
            });
      const sep = !g && process.platform === 'win32' && next() < 0.5 ? '\\' : '/';
      const path = `${root}${sep}${comps.join(sep)}`;
      const named = locator.locate(path, unknownCwd('absolute paths only'));
      const token = `written ${i}\n`;
      if (!g && process.platform === 'win32' && next() < 0.5) {
        // The Win32 API: cmd.exe redirects the token into the path.
        writeFileSync(`${root}.token`, token);
        const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"type "${root}.token" > "${path}""`], { windowsVerbatimArguments: true });
        if (r.status !== 0) {
          seen.failed++;
          continue;
        }
      } else {
        try {
          writeFileSync(path, token);
        } catch {
          seen.failed++;
          if (g) got.push([comps.join('/'), named === null ? 'unplaced' : `placed as ${named}, the write failed`]);
          continue;
        }
      }
      const after = snapshot();
      // What changed: a file whose content is now the token, or a file that did not exist.
      const changed = [...after.files].filter(([f, text]) => text === token || !start.files.has(f)).map(([f]) => f);
      // Back to the start for the next write.
      for (const f of changed) {
        if (start.files.has(f)) writeFileSync(join(root, f), start.files.get(f)!);
        else rmSync(join(root, f), { force: true });
      }
      if (g) got.push([comps.join('/'), named === null ? 'unplaced' : changed.length === 1 && changed[0] === named ? `placed as ${named}, landed there` : `placed as ${named}, the write changed ${JSON.stringify(changed)}`]);
      if (named === null) {
        seen.unplaced++;
        continue;
      }
      seen.placed++;
      if (changed.length !== 1 || changed[0] !== named) broken.push(`${JSON.stringify(comps.join('/'))}: saidvsdid names ${JSON.stringify(named)}, the write changed ${JSON.stringify(changed)}`);
    }
    rmSync(`${root}.token`, { force: true });
    expect(broken.slice(0, 10)).toEqual([]);
    // Not trivially unplaced, by construction: every guaranteed path ends as it must.
    expect(got).toEqual(GUARANTEED.map(([comps, named]) => [comps.join('/'), named === null ? 'unplaced' : `placed as ${named}, landed there`]));
  }, 120_000);
});
