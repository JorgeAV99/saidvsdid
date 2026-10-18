#!/usr/bin/env node
// May a change touch what the guarantee matrix reads, or anything but documentation? The `full-ci (paths)` job of
// .github/workflows/full-ci.yml asks both (does a pull request need the matrix? the platform jobs?), and the monthly
// run asks the second (did main change?). It fails closed: in doubt, everything runs.
//
//   node scripts/guarantee-matrix-paths.mjs <base> <head>          # the matrix: EXCLUDED
//   node scripts/guarantee-matrix-paths.mjs --docs <base> <head>   # documentation alone: DOCS
//   node scripts/guarantee-matrix-paths.mjs --runner-evidence <base> <head>   # the fixtures vs. the real runners
//   node scripts/guarantee-matrix-paths.mjs --runner-evidence <base> <head>   # the fixtures vs. the real runners
//   # each prints the paths and writes run=true|false to $GITHUB_OUTPUT
//
// - The paths come from `git -c core.quotePath=false diff --no-renames --name-only -z <base>...<head>`: a rename is a
//   deletion and an addition (both paths), a name outside ASCII is printed as it is (never quoted), and NUL separates
//   them (a name may hold a newline).
// - The matrix always runs, unless every changed path is in an explicit exclusion list (EXCLUDED): what the pipeline
//   never reads. An unknown path — a new directory, a grammar, a renamed binary — runs it.
// - run=true whenever the answer is not certain: git fails, its output is not what it should be, or no path changed.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The paths that never run the matrix, and nothing else: what it never reads. The matrix runs
 * scripts/guarantee-matrix.ts with test/guarantee-matrix.ts and every module they import (src/**), the Python scope
 * reader (python/**), the grammars (grammars/**) and the dependencies (package*.json), all outside this list
 * (test/guarantee-matrix-ci.test.ts reads that import closure and fails if any of it is excluded). The documentation,
 * the benchmark, the fixtures and their recorder (scripts/runner-evidence*, scripts/recorder-*), the CI's files, the
 * licence and the suite's tests (test/**, but the matrix's own test/guarantee-matrix.ts) are not read by it. A pattern is a whole path: `dir/**` is a directory and everything under it; elsewhere `*`
 * is one or more characters other than `/` (`*.md` is a Markdown file at the root). Compared exactly, case included
 * (git's paths).
 */
export const EXCLUDED = ['docs/**', '*.md', 'LICENSE', 'bench/**', 'fixtures/**', 'scripts/runner-evidence*', 'scripts/recorder-*', '.github/**', 'test/**'];

/** Never excluded, whatever matches above: the workflow that runs the matrix, and the matrix's own test file. */
export const NOT_EXCLUDED = ['.github/workflows/full-ci.yml', 'test/guarantee-matrix.ts'];

/**
 * Documentation alone: the platform jobs of full-ci.yml and the monthly run skip a change made only of these (ci.yml's
 * paths-ignore). `node scripts/guarantee-matrix-paths.mjs --docs <base> <head>`.
 */
export const DOCS = ['docs/**', '*.md', 'LICENSE', '.github/ISSUE_TEMPLATE/**'];

/**
 * What the fixtures against the real runners never read (scripts/runner-evidence.mjs, `--check`): it imports only
 * scripts/recorder-readers.mjs, reads fixtures/cases and node_modules, and runs each runner in
 * fixtures/.runner/<case>/<side>, whose ancestors are fixtures/ and the root. The analyser (src/**, python/**,
 * grammars/**), the suite (test/**), the benchmark and the documentation are none of that; every other path, a
 * root-level file a runner may find walking up included, runs them (test/guarantee-matrix-ci.test.ts pins both).
 * `node scripts/guarantee-matrix-paths.mjs --runner-evidence <base> <head>`.
 */
export const RUNNER_EVIDENCE = ['docs/**', '*.md', 'LICENSE', '.github/ISSUE_TEMPLATE/**', 'bench/**', 'src/**', 'python/**', 'grammars/**', 'test/**'];

/** Whether `path` matches the pattern `pattern` (above): `dir/**`, or a whole path with at most one `*`. */
function matches(pattern, path) {
  if (pattern.endsWith('/**')) return path.startsWith(pattern.slice(0, -2));
  const parts = pattern.split('*');
  if (parts.length === 1) return path === pattern;
  if (parts.length !== 2) throw new Error(`unsupported pattern ${pattern}`);
  const [before, after] = parts;
  if (!path.startsWith(before) || !path.endsWith(after) || path.length <= before.length + after.length) return false;
  return !path.slice(before.length, path.length - after.length).includes('/');
}

/** Whether a path is excluded by `list` (the matrix's by default); NOT_EXCLUDED wins for the matrix's list. */
export function excluded(path, list = EXCLUDED) {
  if (list === EXCLUDED && NOT_EXCLUDED.includes(path)) return false;
  return list.some((pattern) => matches(pattern, path));
}

/** The paths a diff changes, renames as a deletion and an addition; throws when git does not answer. */
export function changedPaths(base, head, cwd = process.cwd()) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', 'diff', '--no-renames', '--name-only', '-z', `${base}...${head}`], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git diff exited ${r.status}: ${(r.stderr ?? '').trim()}`);
  if (!r.stdout.endsWith('\0') && r.stdout !== '') throw new Error('git diff output is not NUL-terminated');
  return r.stdout.split('\0').filter((p) => p !== '');
}

/** The decision, failing closed: run unless git answered with at least one path and every one is excluded. */
export function decide(base, head, cwd = process.cwd(), list = EXCLUDED) {
  let paths;
  try {
    paths = changedPaths(base, head, cwd);
  } catch (e) {
    return { run: true, paths: [], why: `the changed paths could not be read (${e instanceof Error ? e.message : String(e)}): run` };
  }
  if (paths.length === 0) return { run: true, paths, why: 'no changed path was read: run' };
  const runs = paths.filter((p) => !excluded(p, list));
  return runs.length > 0 ? { run: true, paths, why: `not excluded: ${runs.join(', ')}` } : { run: false, paths, why: 'every changed path is excluded' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const scopes = { '--docs': DOCS, '--runner-evidence': RUNNER_EVIDENCE };
  const scope = Object.hasOwn(scopes, args[0] ?? '') ? scopes[args[0]] : null;
  const [base, head] = scope ? args.slice(1) : args;
  let decision;
  try {
    decision = base && head ? decide(base, head, process.cwd(), scope ?? EXCLUDED) : { run: true, paths: [], why: 'usage: guarantee-matrix-paths.mjs <base> <head>; run' };
  } catch (e) {
    decision = { run: true, paths: [], why: `unexpected error (${e instanceof Error ? e.message : String(e)}): run` };
  }
  for (const p of decision.paths) console.log(p);
  console.log(`run=${decision.run} (${decision.why})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${decision.run}\n`);
}
