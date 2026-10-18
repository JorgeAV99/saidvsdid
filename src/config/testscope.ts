// What part of a runner configuration file affects the tests (TG005 and the config net, docs/rules.md): an explicit
// scope, decided per file kind, and compared as written within it.
//
// - package.json: the `test` and `test:*` scripts that existed at base (a script added by the PR loses no test), and
//   the runners' and coverage tools' own sections (`jest`, `vitest`, `mocha`, `ava`, `c8`, `nyc`); never the version,
//   the dependencies or other scripts. A package.json inside a test fixture directory is test data, not watched.
// - pyproject.toml, setup.cfg, tox.ini: their pytest and coverage sections (and tox's environments, which run the
//   tests); not the project's metadata.
// - vite and vitest configs: the `test` section, where a project's own module resolution (`resolve`, `define`,
//   `plugins` of an inline project) is left out: it changes how imports resolve, not which tests are selected.
// Anything that cannot be split with certainty (a file the readers cannot locate sections in, a config that is not
// a literal object) is compared whole: in doubt, it counts.
import { canonical, prop, type ConfigValue } from './values.js';

/** A directory that holds test fixtures: `fixtures`, `fixture`, `__fixtures__`, at any depth (compared without case). */
export function inFixtureDir(path: string): boolean {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return dir.split('/').some((part) => /^(?:__fixtures__|fixtures?)$/i.test(part));
}

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1).toLowerCase();

/** Which sections of a pytest ini source affect the tests, by its file name; null when the file is not one. */
function watchedSection(file: string): ((name: string) => boolean) | null {
  const b = basename(file);
  if (b === 'pyproject.toml') return (n) => /^tool(?:\.(?:pytest|coverage)(?:\..*)?)?$/.test(n);
  if (b === 'setup.cfg') return (n) => n === 'tool:pytest' || n === 'pytest' || /^coverage:/.test(n);
  if (b === 'tox.ini') return (n) => n === 'pytest' || n === 'tox' || n === 'tox:tox' || /^testenv(?::.*)?$/.test(n) || /^coverage:/.test(n);
  return null;
}

/**
 * The raw text of the sections of `file` that affect the tests, in order, or null when the file is not a sectioned
 * pytest source or cannot be split with certainty (then the whole file counts). TOML's root table counts when it
 * holds a dotted `tool.` key.
 */
export function testSections(file: string, text: string): string | null {
  const watched = watchedSection(file);
  if (!watched) return null;
  const toml = basename(file) === 'pyproject.toml';
  const out: string[] = [];
  let current: string | null = '';
  let keep = false;
  let root: string[] = [];
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:[#;].*)?$/.exec(line);
    if (header) {
      current = header[1]!.replace(/["']/g, '');
      keep = watched(current);
      if (keep) out.push(`[${current}]`);
      continue;
    }
    if (current === '') root.push(line);
    else if (keep) out.push(line);
  }
  if (toml && root.some((l) => /^\s*tool\s*\./.test(l))) out.unshift(...root);
  else if (!toml && root.some((l) => l.trim() !== '' && !/^\s*[#;]/.test(l))) return null; // keys before any section
  root = [];
  return out.join('\n');
}

/** A vitest project or workspace entry as it selects tests: a path kept whole, an inline project without its module resolution. */
function selectionView(v: ConfigValue): ConfigValue {
  if (v.t === 'arr') return { ...v, items: v.items.map(selectionView) };
  if (v.t !== 'obj') return v;
  const props = new Map([...v.props].filter(([k]) => !['resolve', 'define', 'plugins', 'esbuild', 'css', 'server', 'optimizeDeps', 'ssr', 'build', 'cacheDir', 'envPrefix', 'publicDir'].includes(k)));
  return { ...v, props };
}

/** `test.projects`/`test.workspace` as they select tests (an inline project's `resolve.alias` changes no selection). */
export function projectsView(v: ConfigValue): string {
  return canonical(selectionView(v));
}

/** A vite or vitest config's `test` section, with inline projects as they select tests; null when the config is not a literal object. */
export function testView(config: ConfigValue): string | null {
  if (config.t !== 'obj' || config.open) return null;
  // Vitest's root is vite's `root` unless the test section sets its own: where the tests are looked for.
  const root = `root=${canonical(prop(config, 'root'))}`;
  const test = prop(config, 'test');
  if (!test) return `${root};test=absent`;
  if (test.t !== 'obj') return `${root};test=${canonical(test)}`;
  const props = new Map([...test.props].map(([k, x]) => [k, k === 'projects' || k === 'workspace' ? selectionView(x) : x] as const));
  return `${root};test=${canonical({ ...test, props })}`;
}
