import type { Evidence } from '../evidence/schema.js';
import type { RepoModel } from '../location.js';
import type { Unverifiable } from '../report/model.js';
import type { FileChange } from '../git/diff.js';
import type { TestFile } from '../parse/index.js';
import type { Matching } from './match.js';

export const RULE_IDS = ['TG001', 'TG002', 'TG003', 'TG004', 'TG005', 'TG006', 'TG007'] as const;
export type RuleId = (typeof RULE_IDS)[number];

export type Severity = 'fail' | 'warn' | 'info';

import type { FailEffect } from './effects.js';
import type { TestId } from './ids.js';

export interface Finding {
  rule: RuleId;
  severity: Severity;
  /** Repo-relative path the finding points at. */
  file: string;
  /** Which side of the diff `file`/`line` refer to. */
  side: 'base' | 'head';
  line: number | null;
  /** Test the finding is about, when it is about exactly one. */
  test: string | null;
  message: string;
  /** Why, machine-readable, for the rules that say (TG006: its first warn reason, or `consistent_unverified`/`disclosed`; TG007: `no_test_in_diff`, `superseded`, …). */
  reason?: string;
  /** Set on every FAIL: what it does to the tests, as the real runner would show it (src/rules/effects.ts). */
  effect?: FailEffect;
  /** Tests affected, for findings that group several (e.g. a `describe.skip`). */
  tests?: string[];
  /**
   * Set on every FAIL of TG001–TG003: the identities (name, ordinal; src/rules/ids.ts) of the tests whose status the FAIL
   * is about, in `file` on `side` — the tests a deleted file declared that ran, the tests a new focus leaves out, the
   * tests a marker applies to. The runner-evidence oracle reads these tests' status alone (test/runner-evidence.test.ts).
   */
  ids?: TestId[];
  /**
   * Internal, not reported: set on findings attributed with certainty (a test
   * deleted, skipped unconditionally, or with assertions removed or relaxed).
   * When the agent's last turn also claims the suite passes, the finding keeps
   * its severity and says so, as context (src/check.ts: addClaimContext).
   */
  tampering?: true;
}

export interface Snapshot {
  sha: string;
  /** Test files that exist on this side, keyed by their path on this side. */
  files: Map<string, TestFile>;
}

/** Read access to both sides of the diff, beyond the changed test files. */
export interface RepoView {
  read(side: 'base' | 'head', path: string): string | null;
  /** Every file at that side, or null when no listing is available (in-memory analysis). */
  list(side: 'base' | 'head'): readonly string[] | null;
  /** Parses any JS/TS/Python file at that side (cached); null if absent or not a supported language. */
  parse(side: 'base' | 'head', path: string): Promise<TestFile | null>;
}

export interface CheckContext {
  base: Snapshot;
  head: Snapshot;
  /** Changed test files. */
  changes: FileChange[];
  /** Every changed file that is not excluded (renames included). */
  allChanges: FileChange[];
  /** Changed runner configuration files (package.json, vitest/jest/playwright configs, pytest ini sources, conftest.py). */
  configChanges: FileChange[];
  repo: RepoView;
  /** base path → head path for renamed files. */
  renames: Map<string, string>;
  matching: Matching;
  evidence: Evidence | null;
  /** What findings about the evidence point at: the transcript or evidence file name. */
  evidenceLabel: string;
  /** The repository's trees at base and head (none when unknown): evidence paths are resolved in them. */
  model: RepoModel;
  /** Repository on disk, when the analysis runs on one (needed by --f2p). */
  repoDir: string | null;
  /** --f2p: run new/modified regression tests on base and head. null when not requested. */
  f2p: F2pOptions | null;
  /** Rules add what they could not verify here; it makes the verdict UNVERIFIABLE. */
  unverifiable: Unverifiable[];
}

export interface F2pOptions {
  /** Per runner invocation. */
  timeoutMs: number;
}

export interface Rule {
  id: RuleId;
  title: string;
  run(ctx: CheckContext): Finding[] | Promise<Finding[]>;
}
