// pytest configuration as pytest reads it.
//
// Sources, in pytest's order of precedence within one directory: pytest.ini
// (always, even without a [pytest] section), .pytest.ini, pyproject.toml with
// [tool.pytest.ini_options], tox.ini with [pytest], setup.cfg with
// [tool:pytest]. The configuration that applies to a file is the first one
// found walking up from its directory (pytest's rootdir/inifile discovery
// when it is given that path).
import type { Node } from 'web-tree-sitter';
import { getParser } from '../parse/loader.js';
import { pyString } from '../parse/normalise.js';
import { parseIni } from './ini.js';
import { tomlTable } from './toml.js';
import { shellWords, type ConfigValue } from './values.js';
import { nameTable } from '../util/names.js';

export const PYTEST_CONFIG_FILES = ['pytest.ini', '.pytest.ini', 'pyproject.toml', 'tox.ini', 'setup.cfg'] as const;

export interface PytestOption {
  /** Raw value: a string from an INI file or TOML, or a TOML array. */
  value: string | string[] | boolean | number | null;
  line: number;
}

export interface PytestConfig {
  path: string;
  options: Map<string, PytestOption>;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The pytest configuration held by `path`, or null if the file is not a pytest config. */
export function readPytestConfig(path: string, text: string): PytestConfig | null {
  const name = basename(path);
  const options = new Map<string, PytestOption>();
  if (name === 'pyproject.toml') {
    const table = tomlTable(text, 'tool.pytest.ini_options');
    if (!table) return null;
    for (const [k, v] of table.entries) options.set(k, { value: tomlOption(v), line: v.line });
    return { path, options };
  }
  const section = name === 'setup.cfg' ? 'tool:pytest' : 'pytest';
  const ini = parseIni(text);
  const entries = ini.get(section);
  if (!entries) return name === 'pytest.ini' || name === '.pytest.ini' ? { path, options } : null;
  for (const [k, e] of entries) options.set(k, { value: e.value, line: e.line });
  return { path, options };
}

function tomlOption(v: ConfigValue): PytestOption['value'] {
  if (v.t === 'str' || v.t === 'num' || v.t === 'bool') return v.v;
  if (v.t === 'arr' && v.items.every((i) => i.t === 'str')) return v.items.map((i) => (i as { v: string }).v);
  return null; // present but not understood
}

/** An option as a list of words (addopts: shell-split string or TOML array), or null if unreadable. */
export function optionArgs(o: PytestOption | undefined): string[] | null {
  if (!o) return [];
  if (typeof o.value === 'string') return shellWords(o.value);
  if (Array.isArray(o.value)) return o.value;
  return null;
}

/** A "linelist"/"args" ini option (testpaths, python_files, norecursedirs): whitespace-separated or TOML array. */
export function optionList(o: PytestOption | undefined): string[] | null {
  if (!o) return null;
  // Quotes or backslashes in an INI value: how pytest splits them is not
  // modelled, so the value is not read (the caller treats it as uncertain).
  if (typeof o.value === 'string') return /["'\\]/.test(o.value) ? null : o.value.split(/\s+/).filter(Boolean);
  if (Array.isArray(o.value)) return o.value;
  return null;
}

/** pytest's boolean ini parsing (`_strtobool`). Undefined when absent, null when unreadable. */
export function optionBool(o: PytestOption | undefined): boolean | null | undefined {
  if (!o) return undefined;
  if (typeof o.value === 'boolean') return o.value;
  if (typeof o.value !== 'string') return null;
  const v = o.value.trim().toLowerCase();
  if (['y', 'yes', 't', 'true', 'on', '1'].includes(v)) return true;
  if (['n', 'no', 'f', 'false', 'off', '0'].includes(v)) return false;
  return null;
}

/** Candidate config paths for a file, nearest directory first, in precedence order within each. */
export function configCandidates(filePath: string): string[] {
  const parts = filePath.split('/').slice(0, -1);
  const out: string[] = [];
  for (let i = parts.length; i >= 0; i--) {
    const dir = parts.slice(0, i).join('/');
    for (const name of PYTEST_CONFIG_FILES) out.push(dir ? `${dir}/${name}` : name);
  }
  return out;
}

/** The pytest configuration applying to `filePath` on one side, read through `read`. */
export function pytestConfigFor(filePath: string, read: (path: string) => string | null): PytestConfig | null {
  for (const candidate of configCandidates(filePath)) {
    const text = read(candidate);
    if (text === null) continue;
    const config = readPytestConfig(candidate, text);
    if (config) return config;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Command-line arguments (addopts, or a `pytest ...` script)

export interface PytestArgs {
  k: string | null;
  m: string | null;
  deselect: string[];
  ignore: string[];
  ignoreGlob: string[];
  paths: string[];
  reruns: number | null;
  timeout: number | null;
  /** Words we could not classify with certainty (a value-taking option we do not know). */
  unclassified: string[];
}

/** Options that take a value, so the next word is not a path. */
const VALUE_OPTIONS = new Set([
  '-k', '-m', '-p', '-c', '-o', '-W', '-r', '-n', '--deselect', '--ignore', '--ignore-glob', '--rootdir', '--basetemp',
  '--maxfail', '--tb', '--durations', '--durations-min', '--junitxml', '--junit-xml', '--junit-prefix', '--cov',
  '--cov-report', '--cov-config', '--cov-fail-under', '--timeout', '--timeout-method', '--reruns', '--reruns-delay',
  '--only-rerun', '--dist', '--log-level', '--log-cli-level', '--log-file', '--log-format', '--confcutdir',
  '--import-mode', '--capture', '--color', '--override-ini', '--config-file', '--cache-show', '--pyargs',
  '--doctest-glob', '--show-capture', '--asyncio-mode', '--randomly-seed', '--html', '--numprocesses', '--maxprocesses',
]);

export function parsePytestArgs(words: string[]): PytestArgs {
  const out: PytestArgs = { k: null, m: null, deselect: [], ignore: [], ignoreGlob: [], paths: [], reruns: null, timeout: null, unclassified: [] };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    let opt = w;
    let val: string | undefined;
    const eq = w.startsWith('--') ? w.indexOf('=') : -1;
    if (eq !== -1) {
      opt = w.slice(0, eq);
      val = w.slice(eq + 1);
    } else if (/^-[kmpcoWrn]./.test(w)) {
      opt = w.slice(0, 2);
      val = w.slice(2);
    }
    if (!w.startsWith('-')) {
      out.paths.push(w);
      continue;
    }
    const takesValue = VALUE_OPTIONS.has(opt);
    if (takesValue && val === undefined) val = words[++i];
    if (!takesValue && val !== undefined && eq !== -1) {
      out.unclassified.push(w);
      continue;
    }
    if (!takesValue && /^--[\w-]+$/.test(opt) && words[i + 1] !== undefined && !words[i + 1]!.startsWith('-')) {
      // An unknown long option followed by a word: that word may be its value or a path.
      out.unclassified.push(w, words[i + 1]!);
      i++;
      continue;
    }
    switch (opt) {
      case '-k':
        out.k = val ?? null;
        break;
      case '-m':
        out.m = val ?? null;
        break;
      case '--deselect':
        if (val) out.deselect.push(val);
        break;
      case '--ignore':
        if (val) out.ignore.push(val);
        break;
      case '--ignore-glob':
        if (val) out.ignoreGlob.push(val);
        break;
      case '--reruns':
        out.reruns = val !== undefined && /^\d+$/.test(val) ? Number(val) : null;
        break;
      case '--timeout':
        out.timeout = val !== undefined && /^\d+(\.\d+)?$/.test(val) ? Number(val) : null;
        break;
      default:
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// conftest.py: collect_ignore / collect_ignore_glob

export interface Conftest {
  path: string;
  /** Null when the lists are built in a way we cannot read (conditions, computed values). */
  collectIgnore: string[] | null;
  collectIgnoreGlob: string[] | null;
  /** Line of the first mention of either list; 1 when absent. */
  line: number;
}

function stringItems(list: Node): string[] | null {
  const out: string[] = [];
  for (const item of list.namedChildren) {
    if (item.type === 'comment') continue;
    const value = pyString(item);
    if (value === null) return null;
    out.push(value);
  }
  return out;
}

/** The lists a conftest.py may set, by the name of the module-level variable. */
const CONFTEST_LISTS = nameTable('CONFTEST_LISTS', { collect_ignore: 'collectIgnore', collect_ignore_glob: 'collectIgnoreGlob' } as const);

export async function readConftest(path: string, source: string): Promise<Conftest> {
  const tree = (await getParser('python')).parse(source);
  const result: Conftest = { path, collectIgnore: [], collectIgnoreGlob: [], line: 1 };
  if (!tree) return { ...result, collectIgnore: null, collectIgnoreGlob: null };
  try {
    const root = tree.rootNode;
    const lists = CONFTEST_LISTS;
    let first = 0;
    const note = (n: Node): void => {
      if (first === 0 || n.startPosition.row + 1 < first) first = n.startPosition.row + 1;
    };
    // Any mention outside a plain top-level statement makes the list unreadable.
    for (const id of root.descendantsOfType('identifier')) {
      const key = lists[id.text as keyof typeof lists];
      if (!key) continue;
      note(id);
      let stmt: Node | null = id;
      while (stmt && stmt.parent?.id !== root.id) stmt = stmt.parent;
      if (!stmt || stmt.type !== 'expression_statement') result[key] = null;
    }
    for (const stmt of root.namedChildren) {
      if (stmt.type !== 'expression_statement') continue;
      const e = stmt.namedChildren[0];
      if (!e) continue;
      let name: string | null = null;
      let items: string[] | null = null;
      if (e.type === 'assignment' || e.type === 'augmented_assignment') {
        name = e.childForFieldName('left')?.text ?? null;
        const right = e.childForFieldName('right');
        items = right && right.type === 'list' ? stringItems(right) : null;
        if (e.type === 'assignment' && name && lists[name as keyof typeof lists] && items) {
          const key = lists[name as keyof typeof lists];
          if (result[key] !== null) result[key] = [];
        }
      } else if (e.type === 'call') {
        const fn = e.childForFieldName('function');
        const obj = fn?.type === 'attribute' ? fn.childForFieldName('object')?.text : null;
        const method = fn?.type === 'attribute' ? fn.childForFieldName('attribute')?.text : null;
        const arg = e.childForFieldName('arguments')?.namedChildren[0];
        name = obj ?? null;
        if (method === 'append' && arg?.type === 'string') items = stringItems({ namedChildren: [arg] } as unknown as Node);
        else if (method === 'extend' && arg?.type === 'list') items = stringItems(arg);
        else items = null;
      }
      const key = name ? lists[name as keyof typeof lists] : undefined;
      if (!key) continue;
      const current = result[key];
      result[key] = current === null || items === null ? null : [...current, ...items];
    }
    result.line = first || 1;
    return result;
  } finally {
    tree.delete();
  }
}
