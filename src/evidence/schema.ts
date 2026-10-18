// Canonical evidence format, `evidence/v2`. Documented in docs/evidence.md.
//
// The validator is hand-written (no JSON-Schema dependency) and strict:
// unknown fields, wrong types and bad enum values are all errors, each reported
// with a JSON path so adapters fail loudly instead of silently dropping data.
//
// v2 replaces v1 (M3): events are ordered by their position in the transcript
// (`seq`), never by timestamps; edits say whether they certainly happened; runs
// say whether they ran the whole suite.

export const EVIDENCE_SCHEMA_ID = 'evidence/v2';

export const AGENT_NAMES = ['claude-code', 'codex', 'other'] as const;
export const CLAIM_KINDS = ['suite_passed', 'tests_added', 'regression_test_added'] as const;
export const CLAIM_SOURCES = ['last_assistant_message', 'turn_end', 'pr_body'] as const;
export const CLAIM_CERTAINTIES = ['certain', 'possible', 'disclosed'] as const;
export const EXIT_UNKNOWN_REASONS = ['pipe', 'chain', 'background', 'no_result'] as const;
export const FRAMEWORKS = ['vitest', 'jest', 'playwright', 'pytest', 'unknown'] as const;
export const RUN_SOURCES = ['wrapper', 'hook', 'transcript', 'ci'] as const;
export const RUN_SELECTIONS = ['full', 'filtered', 'unknown'] as const;
export const TEST_STATUSES = ['passed', 'failed', 'skipped'] as const;
export const TRANSCRIPT_FORMATS = ['claude-stream-json', 'claude-jsonl', 'codex-exec-json', 'codex-rollout'] as const;
export const EDIT_CERTAINTIES = ['certain', 'uncertain'] as const;
export const EDIT_VIAS = ['edit_tool', 'patch', 'shell', 'opaque'] as const;

export type AgentName = (typeof AGENT_NAMES)[number];
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export type ClaimSource = (typeof CLAIM_SOURCES)[number];
export type ClaimCertainty = (typeof CLAIM_CERTAINTIES)[number];
export type ExitUnknownReason = (typeof EXIT_UNKNOWN_REASONS)[number];
export type Framework = (typeof FRAMEWORKS)[number];
export type RunSource = (typeof RUN_SOURCES)[number];
export type RunSelection = (typeof RUN_SELECTIONS)[number];
export type TestStatus = (typeof TEST_STATUSES)[number];
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];
export type EditCertainty = (typeof EDIT_CERTAINTIES)[number];
export type EditVia = (typeof EDIT_VIAS)[number];

export interface Evidence {
  schema: typeof EVIDENCE_SCHEMA_ID;
  agent: { name: AgentName; version: string; session_id: string };
  /** Commits the evidence is about; null when the producer does not know them. */
  repo: { base: string | null; head: string | null };
  transcript: TranscriptInfo;
  claims: Claim[];
  runs: Run[];
  edits: Edit[];
}

export interface TranscriptInfo {
  /** null when the evidence does not come from a transcript (`saidvsdid run`). */
  format: TranscriptFormat | null;
  /**
   * false when the adapter met something it does not understand that could
   * hide a test run or an edit (an unknown event or tool). Rules then never
   * FAIL on the absence or order of runs.
   */
  complete: boolean;
  /** What the adapter did not recognise, one line each. */
  issues: string[];
}

export interface Claim {
  id: string;
  kind: ClaimKind;
  /** The sentence that triggered the claim. */
  text: string;
  source: ClaimSource;
  /**
   * `certain`: global, present or perfect, unqualified ("All 6 tests pass.").
   * `possible`: reads like a claim but is partial, qualified or contradicted;
   * rules read both the same way (at most a WARN).
   */
  certainty: ClaimCertainty;
  /** Position in the transcript. */
  seq: number;
}

export interface Run {
  id: string;
  /** Position in the transcript where it started (runs of one shell command follow its segments). */
  seq: number;
  /**
   * Position of its end (the tool result), when other events came between its
   * start and its end (calls running at the same time). Absent: it is a point.
   */
  seq_end?: number;
  command: string;
  /**
   * true: a test command saidvsdid recognises (npm test, vitest, jest, pytest,
   * a package.json script that delegates to them). false: a command that might
   * run tests but is not recognised (`make test`, `tox`); never counts as a pass.
   */
  recognized: boolean;
  framework: Framework;
  /** `filtered`: a file, a name pattern (-t, -k), --bail/-x...; not the whole suite. */
  selection: RunSelection;
  /**
   * Where it ran: repo-relative ('' is the root) when placed with certainty;
   * an absolute directory outside the repository; null when unknown. A run
   * backs or contradicts a claim only when its directory is placed.
   */
  cwd: string | null;
  /** `null` means the exit code is unknown. Unknown never counts as a pass. */
  exit_code: number | null;
  /**
   * Why `exit_code` is null: `pipe` (a later command in the pipeline decides
   * the status: `npm test | tail`), `chain` (`;`, `&&`, `||` leave it open),
   * `background`, or `no_result` (no result, interrupted). null when known.
   */
  exit_unknown: ExitUnknownReason | null;
  source: RunSource;
  tree_sha: string | null;
  /** `null` means the runner output could not be summarised. */
  summary: RunSummary | null;
  tests: RunTest[];
  output_sha256: string;
  output_truncated: boolean;
}

export interface RunSummary {
  passed: number;
  failed: number;
  skipped: number;
  /** The runner's own summary says not every test was selected ("deselected", "no tests ran"). */
  partial?: true;
}

export interface RunTest {
  id: string;
  status: TestStatus;
}

export interface Edit {
  /** Position in the transcript where it started. */
  seq: number;
  /** Position of its end, when other events came in between (see `Run.seq_end`). */
  seq_end?: number;
  /**
   * Repo-relative (`/`-separated) when placed in the repository with
   * certainty; otherwise as written, with `placed: false`. null when no path
   * is known (a shell command that may write, an opaque tool).
   */
  path: string | null;
  /** false: `path` could not be placed in the repository with certainty (src/location.ts); absent: placed. */
  placed?: false;
  /**
   * `certain`: an edit tool or patch that succeeded. `uncertain`: a shell
   * command that may have written files, or a tool whose effects the
   * transcript does not show (`via: "opaque"`).
   */
  certainty: EditCertainty;
  via: EditVia;
  /** The shell command, for `via: "shell"`. */
  command: string | null;
}

export type ValidationResult =
  | { ok: true; value: Evidence }
  | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Minimal validator combinators

type Check = (value: unknown, path: string, errors: string[]) => void;

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

const str: Check = (v, p, e) => {
  if (typeof v !== 'string') e.push(`${p}: expected string, got ${describe(v)}`);
};

const nonEmptyStr: Check = (v, p, e) => {
  if (typeof v !== 'string') e.push(`${p}: expected string, got ${describe(v)}`);
  else if (v.length === 0) e.push(`${p}: must not be empty`);
};

const bool: Check = (v, p, e) => {
  if (typeof v !== 'boolean') e.push(`${p}: expected boolean, got ${describe(v)}`);
};

const nonNegIntCheck: Check = (v, p, e) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    e.push(`${p}: expected non-negative integer, got ${JSON.stringify(v) ?? describe(v)}`);
  }
};

const int: Check = (v, p, e) => {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    e.push(`${p}: expected integer, got ${JSON.stringify(v) ?? describe(v)}`);
  }
};

const SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const sha: Check = (v, p, e) => {
  if (typeof v !== 'string' || !SHA_RE.test(v)) {
    e.push(`${p}: expected full lowercase git object id (40 or 64 hex chars), got ${JSON.stringify(v) ?? describe(v)}`);
  }
};

const strArray: Check = (v, p, e) => {
  if (!Array.isArray(v)) e.push(`${p}: expected array, got ${describe(v)}`);
  else v.forEach((x, i) => str(x, `${p}[${i}]`, e));
};

const HEX64_RE = /^[0-9a-f]{64}$/;
const hex64: Check = (v, p, e) => {
  if (typeof v !== 'string' || !HEX64_RE.test(v)) {
    e.push(`${p}: expected lowercase hex SHA-256 (64 chars), got ${JSON.stringify(v) ?? describe(v)}`);
  }
};

function oneOf(options: readonly string[]): Check {
  return (v, p, e) => {
    if (typeof v !== 'string' || !options.includes(v)) {
      e.push(`${p}: expected one of ${options.map((o) => JSON.stringify(o)).join(' | ')}, got ${JSON.stringify(v) ?? describe(v)}`);
    }
  };
}

function literal(expected: string): Check {
  return (v, p, e) => {
    if (v !== expected) e.push(`${p}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(v) ?? describe(v)}`);
  };
}

function nullable(inner: Check): Check {
  return (v, p, e) => {
    if (v !== null) inner(v, p, e);
  };
}

function arrayOf(inner: Check): Check {
  return (v, p, e) => {
    if (!Array.isArray(v)) {
      e.push(`${p}: expected array, got ${describe(v)}`);
      return;
    }
    v.forEach((item, i) => inner(item, `${p}[${i}]`, e));
  };
}

function object(shape: Record<string, Check>, optional: Record<string, Check> = {}): Check {
  return (v, p, e) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      e.push(`${p}: expected object, got ${describe(v)}`);
      return;
    }
    // Fields by own keys only (a field named `constructor` or `toString` is unknown, not the prototype's).
    const record = v as Record<string, unknown>;
    for (const key of Object.keys(shape)) {
      if (!Object.hasOwn(record, key)) e.push(`${p}.${key}: missing required field`);
      else shape[key]!(record[key], `${p}.${key}`, e);
    }
    for (const key of Object.keys(optional)) if (Object.hasOwn(record, key)) optional[key]!(record[key], `${p}.${key}`, e);
    for (const key of Object.keys(record)) {
      if (!Object.hasOwn(shape, key) && !Object.hasOwn(optional, key)) e.push(`${p}.${key}: unknown field (evidence/v2 allows: ${[...Object.keys(shape), ...Object.keys(optional)].join(', ')})`);
    }
  };
}

/** `seq_end`, when present, is not before `seq`. */
const spanCheck: Check = (v, p, e) => {
  const r = v as Record<string, unknown> | null;
  if (r && typeof r['seq'] === 'number' && typeof r['seq_end'] === 'number' && r['seq_end'] < r['seq']) e.push(`${p}.seq_end: must not be less than seq`);
};

function uniqueIds(field: string): Check {
  return (v, p, e) => {
    if (!Array.isArray(v)) return;
    const seen = new Set<unknown>();
    v.forEach((item, i) => {
      const id = (item as Record<string, unknown> | null)?.['id'];
      if (typeof id !== 'string') return;
      if (seen.has(id)) e.push(`${p}[${i}].id: duplicate ${field} id ${JSON.stringify(id)}`);
      seen.add(id);
    });
  };
}

function all(...checks: Check[]): Check {
  return (v, p, e) => checks.forEach((c) => c(v, p, e));
}

// ---------------------------------------------------------------------------

const claimCheck = object({
  id: nonEmptyStr,
  kind: oneOf(CLAIM_KINDS),
  text: str,
  source: oneOf(CLAIM_SOURCES),
  certainty: oneOf(CLAIM_CERTAINTIES),
  seq: nonNegIntCheck,
});

const trueCheck: Check = (v, p, e) => {
  if (v !== true) e.push(`${p}: expected true, got ${describe(v)}`);
};
const summaryCheck = object({ passed: nonNegIntCheck, failed: nonNegIntCheck, skipped: nonNegIntCheck }, { partial: trueCheck });

const runCheck = all(object({
  id: nonEmptyStr,
  seq: nonNegIntCheck,
  command: nonEmptyStr,
  recognized: bool,
  framework: oneOf(FRAMEWORKS),
  selection: oneOf(RUN_SELECTIONS),
  cwd: nullable(str),
  exit_code: nullable(int),
  exit_unknown: nullable(oneOf(EXIT_UNKNOWN_REASONS)),
  source: oneOf(RUN_SOURCES),
  tree_sha: nullable(sha),
  summary: nullable(summaryCheck),
  tests: arrayOf(object({ id: nonEmptyStr, status: oneOf(TEST_STATUSES) })),
  output_sha256: hex64,
  output_truncated: bool,
}, { seq_end: nonNegIntCheck }), spanCheck);

const editCheck = all(object({
  seq: nonNegIntCheck,
  path: nullable(nonEmptyStr),
  certainty: oneOf(EDIT_CERTAINTIES),
  via: oneOf(EDIT_VIAS),
  command: nullable(str),
}, { seq_end: nonNegIntCheck, placed: (v, p, e) => {
  if (v !== false) e.push(`${p}: must be false when present`);
} }), spanCheck);

const schemaCheck: Check = (v, p, e) => {
  if (v === 'evidence/v1') {
    e.push(`${p}: evidence/v1 is no longer accepted; evidence/v2 orders events by their position in the transcript (see docs/evidence.md)`);
  } else literal(EVIDENCE_SCHEMA_ID)(v, p, e);
};

const evidenceCheck = object({
  schema: schemaCheck,
  agent: object({ name: oneOf(AGENT_NAMES), version: str, session_id: str }),
  repo: object({ base: nullable(sha), head: nullable(sha) }),
  transcript: object({ format: nullable(oneOf(TRANSCRIPT_FORMATS)), complete: bool, issues: strArray }),
  claims: all(arrayOf(claimCheck), uniqueIds('claim')),
  runs: all(arrayOf(runCheck), uniqueIds('run')),
  edits: arrayOf(editCheck),
});

export function validateEvidence(value: unknown): ValidationResult {
  const errors: string[] = [];
  evidenceCheck(value, '$', errors);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: value as Evidence };
}

export function parseEvidence(json: string): ValidationResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (err) {
    return { ok: false, errors: [`$: invalid JSON: ${(err as Error).message}`] };
  }
  return validateEvidence(value);
}
