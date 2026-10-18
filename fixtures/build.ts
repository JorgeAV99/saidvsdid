// Builds synthetic git repositories from fixtures/cases/<RULE>/<case>/{base,head}.
//
// Each case becomes a two-commit repo: `base/` is committed first, then the
// working tree is replaced by `head/` and committed again. Author, committer
// and dates are fixed, so the resulting SHAs are identical on every machine.
//
//   npm run fixtures            # builds every case into fixtures/.repos/
//   npm run fixtures -- <dir>   # builds into <dir>
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CASES_DIR = fileURLToPath(new URL('./cases/', import.meta.url));
/** Real agent sessions recorded by scripts/record-session.mjs. */
export const SESSIONS_DIR = fileURLToPath(new URL('./sessions/', import.meta.url));

export type CaseKind = 'positive' | 'negative' | 'hard-legit';

import type { TestId } from '../src/rules/ids.js';
import type { FailEffect } from '../src/rules/effects.js';

export type RunnerStatus = 'passed' | 'failed' | 'skipped' | 'todo' | 'xfailed' | 'xpassed';

export interface ExpectedFinding {
  rule: string;
  severity: 'fail' | 'warn' | 'info';
  file: string;
  test?: string | null;
  line?: number | null;
  /** The finding's machine-readable reason (TG006: `consistent_unverified`, a fail reason…); checked when given. */
  reason?: string;
  /**
   * A FAIL's effect (src/rules/effects.ts), when it is not its rule's (RULE_FAIL_EFFECT): `expected-failure` for TG003's
   * expected-failure markers. Always checked on a FAIL; test/runner-evidence.test.ts asks the runner for its evidence.
   */
  effect?: FailEffect;
  /**
   * The ids of the tests a FAIL of TG001–TG003 is about (Finding.ids, src/rules/ids.ts): always written on such a FAIL,
   * and compared. test/runner-evidence.test.ts reads their status alone, as the runner keys them (`file::id`).
   */
  ids?: TestId[];
}

export interface FixtureCase {
  /** `TG001/deleted-test` */
  id: string;
  dir: string;
  description: string;
  kind: CaseKind;
  /** Extra CLI-equivalent options for `check`. */
  exclude?: string[];
  /**
   * A recorded session (fixtures/sessions/<name>) this case is built on: its
   * base/ and head/ unless the case has its own, and its transcript.jsonl
   * unless the case has its own `transcript`.
   */
  session?: string;
  /** Transcript file, looked up in the case directory, then in the session's. */
  transcript?: string;
  agent?: 'auto' | 'claude' | 'codex';
  /**
   * Entries that only exist in git's tree, on both sides: symlinks (path →
   * target) and submodules (paths). Written straight into the index, so they
   * are the same on every platform.
   */
  links?: Links;
  /**
   * The agent's working directory, as `check --cwd` would give it, for a
   * transcript that does not record one (Codex `exec --json`). `<REPO>` is
   * the repository. Defaults to the session's (session.json `cwd`); null: unknown.
   */
  cwd?: string | null;
  /**
   * An evidence/v2 file in the case directory, given as `check --evidence`. `<BASE>`, `<HEAD>`,
   * `<BASE_TREE>` and `<HEAD_TREE>` stand for the fixture repository's commits and their trees.
   */
  evidence?: string;
  /** Run check with --f2p (TG007 runs the regression tests on base and head). */
  f2p?: boolean;
  /**
   * A negative control of the oracle (fixtures/oracle.ts): what the real runner shows for this change must not count
   * as evidence of a FAIL of that effect (a test broken by the code fails without the runner's expected-failure signal).
   */
  oracleControl?: FailEffect;
  /** The change really moves the runner's selection: `runnerEvidence` must show a different set of tests at head. */
  selectionChanges?: boolean;
  /**
   * The runner evidence holds on a case-insensitive file system only (a config named in another case):
   * `scripts/runner-evidence.mjs` records and checks it on Windows and macOS, and skips it elsewhere.
   */
  caseInsensitiveFs?: boolean;
  /**
   * The fixture is outside the contract's assumption (docs/rules.md, *The contract*): the framework or
   * the test module is modified at run time from another module, so the runner does not do what the
   * code says. Its expectation is the contract's; test/runner-evidence.test.ts checks that the runner
   * indeed disagrees, instead of the usual agreement.
   */
  /**
   * A fixture outside the documented assumptions (docs/rules.md, *Verdicts*): the framework mutated at run time, the
   * runner invoked with a flag or configuration outside the diff that changes how it treats markers (`--runxfail`), a
   * setup that fails by itself. Its expectation is the contract's; the runner must not show the FAIL's effect.
   */
  outsideAssumption?: { reason: 'mutation' | 'runner-invocation' | 'setup-fails'; note: string };
  /**
   * The oldest Python whose `ast` reads the fixture (PEP 695 syntax needs 3.12): an older interpreter
   * rejects the file, so the expectation does not hold there. CI runs Python 3.12 and never skips it.
   */
  minPython?: string;
  /** Real runner used to record `runnerEvidence` (scripts/runner-evidence.mjs). */
  runner?: 'vitest' | 'jest' | 'node:test' | 'playwright' | 'unittest' | 'pytest';
  /** Status of every test as reported by the real runner, per side. */
  runnerEvidence?: { tool: string; base: Record<string, RunnerStatus>; head: Record<string, RunnerStatus> };
  /**
   * The real runner gives a result the recorder cannot represent exactly (scripts/recorder-readers.mjs: a retry, a test
   * object run twice…): the recorder must refuse the fixture with this reason (`unrecordable: <reason>`), and the
   * fixture holds no `runnerEvidence` — the oracle is never handed evidence that does not exist.
   */
  unrecordable?: string;
  expect: {
    verdict: 'OK' | 'WARN' | 'FAIL' | 'UNVERIFIABLE' | 'ERROR';
    findings: ExpectedFinding[];
    /** Rules expected as not evaluated (defaults to none). */
    notEvaluated?: string[];
    /** Files expected to be reported as unverifiable (defaults to none). */
    unverifiable?: { file: string; side: 'base' | 'head' }[];
  };
}

export interface Links {
  symlinks?: Record<string, string>;
  submodules?: string[];
}

export interface FixtureRepo {
  repo: string;
  base: string;
  head: string;
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'saidvsdid fixtures',
  GIT_AUTHOR_EMAIL: 'fixtures@saidvsdid.invalid',
  GIT_COMMITTER_NAME: 'saidvsdid fixtures',
  GIT_COMMITTER_EMAIL: 'fixtures@saidvsdid.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
};

function git(cwd: string, args: string[], date?: string): string {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...GIT_ENV, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  }).trim();
}

function replaceTree(repo: string, from: string | null): void {
  for (const entry of readdirSync(repo)) {
    if (entry !== '.git') rmSync(join(repo, entry), { recursive: true, force: true });
  }
  if (from && existsSync(from)) cpSync(from, repo, { recursive: true });
}

// A submodule's commit: any id will do, git never reads it.
const SUBMODULE_COMMIT = '5ab0d0c0'.repeat(5);

function commit(repo: string, message: string, date: string, links: Links = {}): string {
  // Rebuild the index from scratch: head files are copied within the same
  // second as the base commit, and a same-size change (`4.0.0` → `4.1.0`)
  // would otherwise look "racily clean" to git and be left out of the commit.
  rmSync(join(repo, '.git', 'index'), { force: true });
  git(repo, ['add', '-A']);
  for (const [path, target] of Object.entries(links.symlinks ?? {})) {
    const file = join(repo, '.git', 'symlink-target');
    writeFileSync(file, target);
    const blob = git(repo, ['hash-object', '-w', file]);
    git(repo, ['update-index', '--add', '--cacheinfo', `120000,${blob},${path}`]);
  }
  for (const path of links.submodules ?? []) git(repo, ['update-index', '--add', '--cacheinfo', `160000,${SUBMODULE_COMMIT},${path}`]);
  git(repo, ['commit', '-q', '--allow-empty', '-m', message], date);
  return git(repo, ['rev-parse', 'HEAD']);
}

/** Where a case's base/ and head/ trees are: its own directory, or its session's. */
export function treeDir(caseDir: string, session?: string): string {
  if (existsSync(join(caseDir, 'base')) || existsSync(join(caseDir, 'head')) || !session) return caseDir;
  return join(SESSIONS_DIR, session);
}

/** The working directory a case gives `check` (`--cwd`): its own, else the one its session was recorded in. */
export function caseCwd(c: Pick<FixtureCase, 'cwd' | 'session'>): string | null {
  if (c.cwd !== undefined) return c.cwd;
  if (!c.session) return null;
  const meta = JSON.parse(readFileSync(join(SESSIONS_DIR, c.session, 'session.json'), 'utf8')) as { cwd?: string };
  return meta.cwd ?? null;
}

/** The transcript a case checks, if any. */
export function transcriptPath(c: Pick<FixtureCase, 'dir' | 'session' | 'transcript' | 'evidence'>): string | null {
  // A case checked with --evidence uses its session only for the trees.
  if (c.evidence) return null;
  const name = c.transcript ?? (c.session ? 'transcript.jsonl' : null);
  if (!name) return null;
  const own = join(c.dir, name);
  if (existsSync(own)) return own;
  // A recorded Codex session is checked through its rollout, which records where each command ran
  // (its exec stream does not); a case can still name `transcript.jsonl` to check the stream.
  if (c.session && !c.transcript && existsSync(join(SESSIONS_DIR, c.session, 'rollout.jsonl'))) return join(SESSIONS_DIR, c.session, 'rollout.jsonl');
  if (c.session) return join(SESSIONS_DIR, c.session, name);
  throw new Error(`${c.dir}: transcript ${name} not found`);
}

const ROOT_NODE_MODULES = fileURLToPath(new URL('../node_modules/', import.meta.url));

/**
 * Gives a fixture repository this project's dev dependencies (vitest, jest), as
 * a real node_modules/ whose entries link to ours: --f2p runs the repository's
 * own runner. Undo with `unlinkNodeModules` before deleting the repository.
 */
export function linkNodeModules(repo: string): void {
  const target = join(repo, 'node_modules');
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(ROOT_NODE_MODULES)) {
    if (entry.startsWith('.') && entry !== '.bin') continue;
    symlinkSync(join(ROOT_NODE_MODULES, entry), join(target, entry), 'junction');
  }
}

/** Removes the links made by `linkNodeModules` without following them. */
export function unlinkNodeModules(repo: string): void {
  const nm = join(repo, 'node_modules');
  if (!existsSync(nm)) return;
  for (const entry of readdirSync(nm)) {
    const p = join(nm, entry);
    if (!lstatSync(p).isSymbolicLink()) continue;
    try {
      unlinkSync(p);
    } catch {
      rmdirSync(p); // a Windows junction
    }
  }
}

export function buildFixtureRepo(caseDir: string, outDir: string, session?: string, links?: Links): FixtureRepo {
  const trees = treeDir(caseDir, session);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  git(outDir, ['init', '-q', '-b', 'main']);
  replaceTree(outDir, join(trees, 'base'));
  const base = commit(outDir, 'base', '2026-01-01T00:00:00Z', links);
  replaceTree(outDir, join(trees, 'head'));
  const head = commit(outDir, 'head', '2026-01-02T00:00:00Z', links);
  return { repo: outDir, base, head };
}

/** A case's evidence file, with its placeholders replaced by the fixture repository's commits and trees. */
export function caseEvidence(c: Pick<FixtureCase, 'dir' | 'evidence'>, r: FixtureRepo): string | null {
  if (!c.evidence) return null;
  const tree = (commit: string): string => git(r.repo, ['rev-parse', `${commit}^{tree}`]);
  return readFileSync(join(c.dir, c.evidence), 'utf8')
    .replaceAll('<BASE_TREE>', tree(r.base))
    .replaceAll('<HEAD_TREE>', tree(r.head))
    .replaceAll('<BASE>', r.base)
    .replaceAll('<HEAD>', r.head);
}

export function listCases(root = CASES_DIR): FixtureCase[] {
  const cases: FixtureCase[] = [];
  for (const rule of readdirSync(root).sort()) {
    const ruleDir = join(root, rule);
    if (!statSync(ruleDir).isDirectory()) continue;
    for (const name of readdirSync(ruleDir).sort()) {
      const dir = join(ruleDir, name);
      const meta = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8')) as Omit<FixtureCase, 'id' | 'dir'>;
      cases.push({ id: `${rule}/${name}`, dir, ...meta });
    }
  }
  return cases;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? fileURLToPath(new URL('./.repos/', import.meta.url)));
  for (const c of listCases()) {
    const r = buildFixtureRepo(c.dir, join(out, c.id), c.session, c.links);
    console.log(`${c.id.padEnd(40)} ${r.base.slice(0, 10)}..${r.head.slice(0, 10)}  ${r.repo}`);
  }
}
