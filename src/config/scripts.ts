// The package.json `test` script: which runner it invokes and with which
// arguments. Only direct invocations are understood (`vitest run x`,
// `npx jest --ci`, `cross-env CI=1 vitest`); anything that calls another
// script or shell construct we cannot follow is reported as opaque.
import { shellWords } from './values.js';

export type ScriptRunner = 'vitest' | 'jest' | 'playwright' | 'pytest';

export interface ScriptRun {
  runner: ScriptRunner;
  args: string[];
}

export interface ScriptAnalysis {
  runs: ScriptRun[];
  /** Segments whose effect we cannot see (`npm run other`, `$(...)`, unknown commands are fine). */
  opaque: string[];
}

const LAUNCHERS = new Set(['npx', 'bunx', 'pnpx', 'cross-env', 'dotenv', 'env', 'exec', 'node_modules/.bin/']);

function runnerOf(word: string): ScriptRunner | null {
  const base = word.slice(word.lastIndexOf('/') + 1);
  if (base === 'vitest' || base === 'jest' || base === 'pytest' || base === 'playwright') return base;
  return null;
}

export function analyseTestScript(script: string): ScriptAnalysis {
  const runs: ScriptRun[] = [];
  const opaque: string[] = [];
  // Split on shell operators outside quotes.
  const segments: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < script.length; i++) {
    const c = script[i]!;
    if (quote) {
      if (c === quote) quote = null;
      current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if ((c === '&' && script[i + 1] === '&') || (c === '|' && script[i + 1] === '|')) {
      segments.push(current);
      current = '';
      i++;
    } else if (c === ';' || c === '|') {
      segments.push(current);
      current = '';
    } else current += c;
  }
  segments.push(current);
  for (const seg of segments) {
    if (/[`$]\(|\$\{/.test(seg)) {
      opaque.push(seg.trim());
      continue;
    }
    const words = shellWords(seg);
    if (!words || words.length === 0) continue;
    let i = 0;
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!) || LAUNCHERS.has(words[i]!) || words[i] === '--')) i++;
    if (words[i] === 'pnpm' || words[i] === 'yarn' || words[i] === 'bun') {
      if (words[i + 1] === 'exec' || words[i + 1] === 'dlx' || words[i + 1] === 'x') i += 2;
      else if (words[i + 1] && runnerOf(words[i + 1]!)) i += 1;
    }
    if ((words[i] === 'python' || words[i] === 'python3') && words[i + 1] === '-m' && words[i + 2] === 'pytest') {
      runs.push({ runner: 'pytest', args: words.slice(i + 3) });
      continue;
    }
    const runner = words[i] ? runnerOf(words[i]!) : null;
    if (runner) {
      runs.push({ runner, args: words.slice(i + 1) });
      continue;
    }
    if (['npm', 'pnpm', 'yarn', 'bun', 'turbo', 'nx', 'lerna', 'make', 'sh', 'bash', 'node'].includes(words[i] ?? '')) opaque.push(seg.trim());
  }
  return { runs, opaque };
}

export interface VitestArgs {
  filters: string[];
  exclude: string[];
  passWithNoTests: boolean;
  testTimeout: number | null;
  retry: number | null;
  /** Options that change the selection in ways we do not model (`--project`, `-t`, `related`, `--root`). */
  opaque: string[];
}

const VITEST_VALUE = new Set([
  '--config', '-c', '--root', '-r', '--dir', '--exclude', '--project', '--reporter', '--outputFile', '--testNamePattern',
  '-t', '--testTimeout', '--hookTimeout', '--retry', '--shard', '--environment', '--pool', '--maxWorkers', '--minWorkers',
  '--mode', '--sequence.seed', '--bail', '--changed', '--coverage.provider', '--coverage.reporter',
  '--coverage.include', '--coverage.exclude', '--coverage.reportsDirectory', '--typecheck.include',
]);
const VITEST_BOOLEAN = new Set([
  '--passWithNoTests', '--run', '--watch', '--allowOnly', '--globals', '--dom', '--isolate', '--no-isolate', '--ui', '--update',
  '-u', '--typecheck', '--hideSkippedTests', '--clearScreen', '--no-color', '--color', '--silent', '--no-file-parallelism',
  '--standalone', '--expandSnapshotDiff', '--logHeapUsage',
]);
const VITEST_OPAQUE =new Set(['--root', '-r', '--dir', '--project', '--testNamePattern', '-t', '--shard', '--changed', '--config', '-c', '--mode']);

export function parseVitestArgs(args: string[]): VitestArgs {
  const out: VitestArgs = { filters: [], exclude: [], passWithNoTests: false, testTimeout: null, retry: null, opaque: [] };
  let rest = args;
  if (['run', 'watch', 'dev'].includes(rest[0] ?? '')) rest = rest.slice(1);
  else if (['related', 'bench', 'list', 'init'].includes(rest[0] ?? '')) out.opaque.push(rest[0]!);
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!;
    if (!w.startsWith('-')) {
      if (/:\d+$/.test(w)) out.opaque.push(w);
      else out.filters.push(w.replace(/^\.\//, ''));
      continue;
    }
    const eq = w.indexOf('=');
    const opt = eq === -1 ? w : w.slice(0, eq);
    let val: string | undefined = eq === -1 ? undefined : w.slice(eq + 1);
    if (VITEST_VALUE.has(opt) && val === undefined && rest[i + 1] !== undefined && !rest[i + 1]!.startsWith('-')) val = rest[++i];
    if (opt === '--passWithNoTests') out.passWithNoTests = val !== 'false';
    else if (opt === '--exclude' && val) out.exclude.push(val);
    else if (opt === '--testTimeout') out.testTimeout = val && /^\d+$/.test(val) ? Number(val) : null;
    else if (opt === '--retry') out.retry = val && /^\d+$/.test(val) ? Number(val) : null;
    else if (VITEST_OPAQUE.has(opt)) out.opaque.push(val === undefined ? opt : `${opt} ${val}`);
    else if (!VITEST_VALUE.has(opt) && !VITEST_BOOLEAN.has(opt) && val === undefined && rest[i + 1] !== undefined && !rest[i + 1]!.startsWith('-')) {
      // An option we do not know, followed by a word: the word may be its value, not a filter.
      out.opaque.push(`${w} ${rest[i + 1]}`);
      i++;
    }
  }
  return out;
}

export interface JestArgs {
  ignore: string[];
  passWithNoTests: boolean;
  testTimeout: number | null;
  /** Positional patterns and selection options we do not evaluate (regexes over absolute paths, `-o`, `--changedSince`). */
  opaque: string[];
}

const JEST_VALUE = new Set(['--config', '-c', '--testTimeout', '--testNamePattern', '-t', '--testPathPattern', '--testPathPatterns', '--selectProjects', '--shard', '--changedSince', '--roots', '--testMatch', '--testRegex', '--maxWorkers', '-w', '--reporters', '--coverageReporters', '--outputFile', '--rootDir']);
const JEST_OPAQUE = new Set(['--config', '-c', '--testNamePattern', '-t', '--testPathPattern', '--testPathPatterns', '--selectProjects', '--shard', '--changedSince', '--roots', '--testMatch', '--testRegex', '-o', '--onlyChanged', '--lastCommit', '--findRelatedTests', '--rootDir', '--listTests']);

export function parseJestArgs(args: string[]): JestArgs {
  const out: JestArgs = { ignore: [], passWithNoTests: false, testTimeout: null, opaque: [] };
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!;
    if (!w.startsWith('-')) {
      out.opaque.push(w); // a testPathPattern regex, matched against absolute paths
      continue;
    }
    const eq = w.indexOf('=');
    const opt = eq === -1 ? w : w.slice(0, eq);
    let val: string | undefined = eq === -1 ? undefined : w.slice(eq + 1);
    if (opt === '--testPathIgnorePatterns') {
      if (val !== undefined) out.ignore.push(val);
      else while (args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) out.ignore.push(args[++i]!);
      continue;
    }
    if (JEST_VALUE.has(opt) && val === undefined && args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) val = args[++i];
    if (opt === '--passWithNoTests') out.passWithNoTests = val !== 'false';
    else if (opt === '--testTimeout') out.testTimeout = val && /^\d+$/.test(val) ? Number(val) : null;
    else if (JEST_OPAQUE.has(opt)) out.opaque.push(val === undefined ? opt : `${opt} ${val}`);
  }
  return out;
}
