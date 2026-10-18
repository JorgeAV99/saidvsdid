# Evidence format: `evidence/v2`

An evidence file records what a coding agent *said* (claims) and what it
*did* (test runs and file edits) during a session. `saidvsdid` never trusts the
agent's summary: rules TG006 and TG007 compare claims against runs.

Evidence is produced by

- the transcript adapters (`saidvsdid evidence from-transcript <file>`, or
  directly `saidvsdid check --transcript <file>`): Claude Code's interactive
  JSONL (`~/.claude/projects/…/<session>.jsonl`), `claude -p --output-format
  stream-json --verbose`, Codex `exec --json`, and Codex's own session logs
  (`~/.codex/sessions/**/rollout-*.jsonl`, CLI and desktop app);
- the wrapper `saidvsdid run -o evidence.json -- <command>`,

and can be validated with:

```
npx saidvsdid evidence validate evidence.json
```

The validator lives in [`src/evidence/schema.ts`](../src/evidence/schema.ts)
and is strict: **unknown fields, missing fields, wrong types and unknown enum
values are errors**, each reported with its JSON path, e.g.

```
$.runs[0].exit_code: expected integer, got string
$.runs[0].duration_ms: unknown field (evidence/v2 allows: id, seq, command, ...)
```

## Why v2 (milestone 3)

`evidence/v1` ordered events by timestamps and could not say how sure it was
about an edit. v2 replaces it; v1 files are rejected with a message saying so.

- **Order is position, never the clock.** Every claim, run and edit carries
  `seq`, its position in the transcript. Clocks in transcripts are coarse,
  per-machine and sometimes missing; the order of the agent's tool calls is
  exact. There are no timestamps in v2.
- **Edits say how certain they are.** An edit tool (Claude's
  Edit/Write/MultiEdit/NotebookEdit, a Codex `file_change`) that reported
  success is `certain`. A shell command that is not a test run and is not on
  the read-only allow-list (`sed -i`, `>`, `mv`, `rm`, a script, `git
  checkout`, anything unknown) is `uncertain`.
- **Runs say whether they ran the whole suite** (`selection`) and whether the
  command is a runner saidvsdid recognises (`recognized`).
- **The transcript says whether it was fully understood** (`transcript`).

## Top level

| Field | Type | Notes |
|---|---|---|
| `schema` | `"evidence/v2"` | Exact string. |
| `agent` | object | See below. |
| `repo` | object | `base` and `head`: full git object ids (40 or 64 lowercase hex), or `null` when the producer does not know them. `check --evidence` binds the file to the reviewed code with them and with each run's `tree_sha`: one that is not the reviewed commit or head's tree makes TG006/TG007 *not evaluated* (`warn`, `evidence_mismatch`) ([rules.md](rules.md), TG006, *Evidence about other code*). Nothing in evidence verifies a claim. `saidvsdid run` records `head` only when the working copy is exactly HEAD's tree, `base` never. |
| `transcript` | object | See below. |
| `claims` | array | What the agent asserted. |
| `runs` | array | Test commands that were executed. |
| `edits` | array | File modifications, certain or not. |

### `agent`

| Field | Type | Notes |
|---|---|---|
| `name` | `"claude-code"` \| `"codex"` \| `"other"` | |
| `version` | string | Agent version that produced the transcript (`""` if the format does not record it: Codex `exec --json` does not; its rollout does). |
| `session_id` | string | |

### `transcript`

| Field | Type | Notes |
|---|---|---|
| `format` | `"claude-stream-json"` \| `"claude-jsonl"` \| `"codex-exec-json"` \| `"codex-rollout"` \| `null` | `null` for `saidvsdid run`. |
| `complete` | boolean | `false` when something could hide a test run or an edit: an unknown record, item or tool, a line that is not JSON (**unrecognised**: a gap in the adapter), or a recognised but **opaque** call — an MCP tool (unless it is one of the desktop app's own inert tools; a server's `readOnlyHint` is its own word), a subagent whose calls are in another file. TG006 then says so (`incomplete_transcript`). |
| `issues` | string[] | Everything unrecognised (including unknown fields on known records) and every opaque call, one line each. The contract tests require no unrecognised content in any recorded session; `bench/scan-history.mjs` reports both counts over a local history. |

### `claims[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique among claims. |
| `kind` | `"suite_passed"` \| `"tests_added"` \| `"regression_test_added"` | |
| `text` | string | The sentence that triggered the claim, markdown removed. |
| `source` | `"last_assistant_message"` \| `"turn_end"` \| `"pr_body"` | The final message, or the last message of an earlier turn (before the next user input). |
| `certainty` | `"certain"` \| `"possible"` \| `"disclosed"` | See below. It changes the wording of TG006/TG007, never their severity (at most a `warn`). |
| `seq` | integer ≥ 0 | Position of the message in the transcript. |

Claims are extracted with deterministic English and Spanish patterns from the
agent's message at **every end of turn** (its last message before the next user
input; the adapters record user inputs: Claude Code prompts that are not meta
or compaction text, Codex `UserMessage` items) — never with an LLM — under the
**certainty principle**, with a **monotonic** extractor: adding text to a
message can only lower a claim's certainty, never remove it.

- A suite claim is **certain** only in the strict canonical form: the whole
  sentence is the global claim ("All tests pass.", "All 12 tests passed.",
  "Todos los tests pasan.", "Pasan los 12 tests."), alone on its line (a
  sentence wrapped over several lines is one sentence, and not alone), with no
  parentheses, dashes, quotes or backticks, no heading anywhere before it (a
  line ending in `:` or a Markdown `#`, blank lines notwithstanding), and no
  marker of a condition, a quotation, an example or another time anywhere in
  the message ("if", "as soon as", "once", "when", "should", "expected",
  "example", "before", "earlier", "si", "en cuanto", "cuando", "debería",
  "esperada", "ejemplo", "antes", quotes, a blockquote, a code fence…), nor
  another sentence saying tests are failing now.
- It is **possible** whenever anything else reads like a suite claim: counts,
  partial scopes, the past, hedges, conditions, quotes, headings, and
  negations, exceptions or asides in the same sentence ("All tests pass except
  one.").
- It is **disclosed** when the message says the tests were not run again ("not
  rerun", "I did not run them after the last edit", "unverified", "untested",
  "no los he vuelto a ejecutar", "no los ejecuté después"). An exemption about
  something else ("I did not run the production migration") discloses nothing.
- There is **no claim** only for a direct negation of the claim's own
  predicate, attached to the tests ("not all tests pass", "no pasan todos",
  "2 tests fail", "6 of 7 tests pass", "Tests: 1/10 passed") and for a
  question. A negation or a ratio about something else ("…and not all
  documentation is updated", "1/2 of the documentation", "on 1/10") keeps it.

"Tests pass" alone, without "all", "every", "the full suite" or a count, is
not a suite claim. See [`src/claims/extract.ts`](../src/claims/extract.ts) and
[rules.md](rules.md#tg006-suite-claimed-to-pass-without-supporting-evidence).

### `runs[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique among runs. |
| `seq` | integer ≥ 0 | Position in the transcript where the run started. Runs of one shell command get consecutive positions, in the order of its segments. |
| `seq_end` | integer ≥ `seq`, optional | Position of its end (the tool result) when other events came between its start and its end: calls made in parallel, a Codex rollout item that completed inside a call opened earlier, a background command or one with no result (until the end of the transcript). Absent: the run is a point. An edit is after a run only when its `seq` is greater than the run's end. |
| `command` | string | The test segment of the command, as executed (the launcher `bash -lc`, `powershell -Command` removed). |
| `recognized` | boolean | `true` for `npm test` (and `npm run x`/`yarn x`/`pnpm x` when the script calls vitest, jest, playwright or pytest), `npx vitest`, `vitest`, `jest`, `playwright test`, `pytest`, `python -m pytest`. `false` for a **possible run**: a command that might run tests but is not recognised (`make test`, `tox`, `./run_tests.sh`, `bash verify.sh`), any call that is not certainly a non-execution (outside the read-only list), and every opaque call (an MCP tool, a subagent, an unknown tool), with `exit_code: null` and no summary. It never counts as a pass, and it means there may have been a run. |
| `framework` | `"vitest"` \| `"jest"` \| `"playwright"` \| `"pytest"` \| `"unknown"` | From the command, the package.json script, or the runner's output. |
| `selection` | `"full"` \| `"filtered"` \| `"unknown"` | `filtered`: a file or path, `-t`/`--testNamePattern`, `-k`, `-m`, `--project`, `--bail`, `-x`, `--lf`… `unknown`: options whose effect on the selection is not modelled (`-c`, `-o`, `--workspace`, arguments to a script that does not call a known runner). |
| `cwd` | string \| `null` | Where it ran, following `cd` inside the command: repository-relative (`""` is the root) when placed in the repository with certainty; an absolute directory outside it; `null` when unknown or not established: a call outside the closed grammar of a placed run ([rules.md](rules.md), *Location*), a positional path outside the repository, every run of a Codex `exec --json` stream (it does not record where each command ran; its rollout does), a relative `cd` from an unknown directory. A run backs or contradicts a claim only when its directory is placed ([rules.md](rules.md), *Location*). `saidvsdid run` records it relative to the repository's root (`git rev-parse --show-prefix`). |
| `exit_code` | integer \| `null` | Of this segment. `null` = unknown. **An exit status alone proves nothing**: a run fails only when its summary reports failures, and passes only with a complete, coherent summary and an exit status of 0, or unknown only because of a pipe (see TG006). |
| `exit_unknown` | `"pipe"` \| `"chain"` \| `"background"` \| `"no_result"` \| `null` | Why `exit_code` is null: `pipe` (piped without `pipefail`, `npm test 2>&1 \| tail`), `chain` (`pytest; git diff`, after `&&` when the command failed, `\|\|`), `background`, `no_result` (no result in the transcript, interrupted). `null` when the exit code is known. |
| `source` | `"wrapper"` \| `"hook"` \| `"transcript"` \| `"ci"` | How the run was observed. |
| `tree_sha` | git object id \| `null` | Tree of the working copy when the run started (`saidvsdid run`), if known. A tree that is not head's is a mismatch (*not evaluated*). Head's tree verifies nothing either: what the run really loaded is known only inside the runner. |
| `summary` | object \| `null` | `{ passed, failed, skipped, partial? }` from the runner's summary line (vitest, jest, pytest); `null` if there is none, more than one (two runs in one output), or one whose counts do not add up to its own total. `partial: true` when the summary itself shows that not every test was selected (pytest's `deselected`, `no tests ran`): such a run shows nothing about the whole suite. |
| `tests` | array | `{ id, status }` with status `"passed"` \| `"failed"` \| `"skipped"`; may be empty. |
| `output_sha256` | hex string | SHA-256 of the captured output (the output itself is not stored). |
| `output_truncated` | boolean | `true` if the captured output was cut (Codex `...(truncated)`; the word "truncated" in a Claude tool result). |

### `edits[]`

| Field | Type | Notes |
|---|---|---|
| `seq` | integer ≥ 0 | Position in the transcript where the edit started. |
| `seq_end` | integer ≥ `seq`, optional | Position of its end, as for runs. |
| `path` | string \| `null` | Repository-relative (`/`-separated) when the adapter places it with certainty: under the repository's root (`--repo`, or the `<REPO>` marker), resolved one component at a time in base and head, the same file on a case-sensitive and a case-insensitive file system, through no symlink or submodule ([rules.md](rules.md), *Location*). Otherwise the path as written, with `placed: false`. `null` when no path is known: a shell command that may write, an opaque tool. |
| `placed` | `false`, optional | The path could not be placed in the repository with certainty: an **uncertain** edit for every rule (never stated as a fact). Absent: placed. Rules also resolve a present path again against the repository's trees. |
| `certainty` | `"certain"` \| `"uncertain"` | See above. An edit tool call with no result in the transcript is `uncertain`; one that reported an error is not an edit. |
| `via` | `"edit_tool"` \| `"patch"` \| `"shell"` \| `"opaque"` | `opaque`: a tool outside the closed list of tools that do not edit (an MCP tool, a subagent, Codex's `js`, an unknown tool or item), from its call **to the end of the trace** (`seq_end`): its result is not its end — a subagent or an MCP server may go on working, and a response may be a handle (an id, `status: running`); or content the adapter could not read, spanning the whole transcript. Always `uncertain`, with `path: null`: it may have changed any file. |
| `command` | string \| `null` | The shell segment, for `via: "shell"`. |

## Adapters

**Claude Code** (interactive JSONL and stream-json): `tool_use` and
`tool_result` are paired by `tool_use_id`; records are de-duplicated by `uuid`,
keeping the last copy at the position of the first; `toolUseResult` /
`tool_use_result` may be an object or a string. A Bash result's exit code comes
from `is_error` and the `Exit code N` prefix; `interrupted`,
`backgroundTaskId`, `returnCodeInterpretation` or `run_in_background` make it
unknown. A call starts at its `tool_use` and ends at its `tool_result`: calls
made in between ran at the same time (`seq_end`); a background command, or a
call with no result, may run until the end of the transcript.

Claude Code 2.1.281+ (the desktop app) adds metadata records (`agent-name`,
`mode`, `pr-link`, `file-history-delta`) and fields that carry no tool call,
and `toolUseResult.bashEditDiff`: the files a Bash command changed. Those
files become **certain** edits (`via: "shell"`) that take the **whole
interval of the call**: from before its first segment to after its last one
(and to the call's own end when other calls ran in between). Which segment
wrote them is unknown, so a run in the same call overlaps them (`format &&
npm test` is a WARN that says it is not certain), and a command that started
before a run and finished after it overlaps that run too. Uncertain edits of
the segments that may write take the call's span as well. `persistedOutputPath` (the output was saved to a file and the result
is a preview) marks the output as truncated. A tool result with `toolDenialKind`
(2.1.284: the permission system denied the call) is neither a run nor an edit:
the call never ran. The desktop app's
`mcp__ccd_session__mark_chapter`, `mcp__ccd_pr__get_status` and
`mcp__ccd_pr__set_monitor` are inert; any other MCP tool is opaque.

**Codex rollout** (`~/.codex/sessions`, Codex CLI 0.158 and the desktop app):
what ran is read from `event_msg` / `item_completed` items — `CommandExecution`
(argv with its launcher, `cwd`, `status`, `exit_code`, `aggregated_output`),
`FileChange` (`changes` by path; `move_path` counts too), `AgentMessage`
(content type `Text`; the last one is the final message; one whose `phase` is
`commentary` is not the end of a turn). The model's calls in
`response_item` (`custom_tool_call` `exec`, `function_call` `js`) are the
programs it wrote, whose effects are those items; they are not read twice, but
they bound when an item ran: an item is recorded when it completes, and it
started inside the call that ran it — from the earliest call still open (or,
with none open, anywhere in the turn). So a patch and a test run in one `exec`
program overlap.
`McpToolCall` is opaque whatever its `readOnlyHint` says; `SubAgentActivity`,
`CollabAgentToolCall` and `spawn_agent`/`send_message`/`followup_task` are
opaque subagents. For the recorded sessions, the rollout and the `exec --json`
stream of the same session give the same evidence.

**Codex** (`exec --json`): `command_execution` items give `command`,
`aggregated_output`, `exit_code` and `status` (`declined` never ran); an item
starts at its first event (`item.started`) and ends at its last
(`item.completed`); one still `in_progress` at the end never ended. `file_change` items are certain edits
when `completed`. Commands arrive wrapped in the launcher Codex used; the
wrapper is removed before the command is analysed.

Both adapters record anything they do not recognise in `transcript.issues`.
`evidence from-transcript --strict` turns that into an error; the contract
tests run every recorded session in strict mode, so a new field or type in a
new agent version fails loudly there first.

## Example

```json
{
  "schema": "evidence/v2",
  "agent": { "name": "claude-code", "version": "2.1.283", "session_id": "7f3c9a2e-0b1d-4c55-9e8a-1d2f3a4b5c6d" },
  "repo": {
    "base": "9795b0c65ccee1b1c5a1e6c0a7d53c3f3e8f1a20",
    "head": "3e935abc025f0e1c9d8b7a6f5e4d3c2b1a0f9e8d"
  },
  "transcript": { "format": "claude-stream-json", "complete": true, "issues": [] },
  "claims": [
    { "id": "c1", "kind": "suite_passed", "text": "All tests pass.", "source": "last_assistant_message", "certainty": "certain", "seq": 4 }
  ],
  "runs": [
    {
      "id": "r1",
      "seq": 2,
      "command": "npx vitest run",
      "recognized": true,
      "framework": "vitest",
      "selection": "full",
      "cwd": "",
      "exit_code": 1,
      "exit_unknown": null,
      "source": "transcript",
      "tree_sha": null,
      "summary": { "passed": 41, "failed": 1, "skipped": 0 },
      "tests": [{ "id": "src/validate.test.ts > rejects negative amounts", "status": "failed" }],
      "output_sha256": "5f70bf18a086007016e948b04aed3b82103a36bea41755b6cddfaf10ace3c6ef",
      "output_truncated": false
    }
  ],
  "edits": [
    { "seq": 1, "path": "src/validate.ts", "certainty": "certain", "via": "edit_tool", "command": null },
    { "seq": 3, "path": null, "certainty": "uncertain", "via": "shell", "command": "sed -i s/x/y/ src/validate.ts" }
  ]
}
```

In this example the only recorded run failed (exit code 1, its summary
reports failures): TG006 warns "last visible test run failed"; the `sed -i`
after it would, on its own, be a WARN that says the edit is uncertain.
