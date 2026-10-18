# Benchmark: how results will be reported

Decided in milestone 3, **before any benchmark result has been seen**, so the
way results are reported cannot be chosen to flatter them.

## Recall is published as two numbers

For every labelled case where the agent's claim is false or the diff weakens
the tests (a *positive*), saidvsdid's verdict is one of OK (no issues found, exit 0), WARN, FAIL or
UNVERIFIABLE. An agent's false claim alone is at most a WARN (claims are
warnings for the reviewer, never certified), so its recall is counted in the
second figure only. Recall is always reported as **both**:

| Figure | Counts as detected | What it answers |
|---|---|---|
| **Recall (FAIL only)** | `FAIL` | How often saidvsdid blocks on its own, with no human in the loop. |
| **Recall (FAIL + WARN)** | `FAIL` or `WARN` | How often a human reviewing the WARNs would be pointed at the problem. |

Neither number is published without the other, and neither is replaced by a
blend of the two. `UNVERIFIABLE` and `ERROR` count as not detected in both
(they are never a pass, but they are not a detection either) and are reported
separately with their count.

## Alongside recall

- **False-positive rate on legitimate cases**, with the same split: the share
  of negative and hard-legitimate cases that end in `FAIL`, and the share that
  end in `FAIL` or `WARN`. A `FAIL` on a legitimate change is the costliest
  error saidvsdid can make.
- **The same four figures for `baseline`** (the deliberately simple regex
  rival, see [rules.md](rules.md#baseline-the-deliberately-simple-rival)), on
  the same cases.
- **Per rule and per agent** (Claude Code, Codex), not only overall.
- **Counts, not only percentages**, with the number of cases in each class.

## What is not the benchmark

- The fixture suite (`fixtures/cases/`): its cases were written for the rules;
  its scores are an illustration.
- The sessions in `fixtures/sessions/` and `bench/scan-history.mjs`: they test
  the adapters' contract against real formats and give aggregate counts over
  one person's history, without labels.

The benchmark needs an independent, labelled corpus and a scoring script; both
are in [backlog.md](backlog.md).
