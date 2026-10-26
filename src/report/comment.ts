import { coverageCounts, incomplete } from '../coverage.js';
import { EXPERIMENTAL, type Finding, type RuleId } from '../rules/index.js';
import { verdictLabel, type Report } from './model.js';

/** The hidden line that marks saidvsdid's own PR comment, so a later run updates it instead of adding another. */
export const COMMENT_MARKER = '<!-- saidvsdid:pr-comment -->';

/** What the Action's `fail-on` input asked for: nothing fails the check, or this verdict and worse ones do. */
export type FailOn = 'none' | 'fail' | 'warn';

/** Where a finding's file and line are on GitHub, on the side of the diff it points at; null: no link. */
export type LineLink = (side: 'base' | 'head', file: string, line: number | null) => string | null;

export interface CommentOptions {
  link: LineLink | null;
  failOn: FailOn;
  /** GitHub's limit for a comment is 65,536 characters; findings past it are counted, not shown. */
  maxLength?: number;
}

const ICON = { fail: '❌', warn: '⚠️', info: 'ℹ️' } as const;

/** The changed test files the coverage notice lists by name; the rest are counted. */
const MAX_COVERAGE_FILES = 10;

/** What happened to the tests, in the order a reviewer reads it. Each rule belongs to exactly one group. */
export const GROUPS: readonly { title: string; rules: readonly RuleId[] }[] = [
  { title: 'Tests removed or replaced', rules: ['TG001'] },
  { title: 'Tests skipped, focused or marked to fail', rules: ['TG002', 'TG003'] },
  { title: 'Assertions removed or relaxed', rules: ['TG004'] },
  { title: 'Configuration, timeouts and retries changed', rules: ['TG005'] },
  { title: "The agent's claims (experimental)", rules: ['TG006', 'TG007'] },
];

/** CommonMark's line endings (LF, CRLF, a lone CR). */
const LINE_ENDING = /\r\n?|\n/g;

/** The longest text the comment shows of one message, name, path or reason, in code points, its ellipsis included. */
export const MAX_TEXT = 200;

/** At most MAX_TEXT code points: past it, the first MAX_TEXT - 1 and an ellipsis. */
function shorten(s: string): string {
  const points = [...s];
  return points.length > MAX_TEXT ? `${points.slice(0, MAX_TEXT - 1).join('')}…` : s;
}

/**
 * The report's text with nothing in it that a code span reads: every backtick is U+02CB (ˋ), which looks like one, so
 * no run of them can close the span or open a fence; line breaks and tabs are spaces, so it stays on its line; and it
 * is at most MAX_TEXT long. Never a fence sized to the text: GitHub's renderer (cmark-gfm) stops reading a backtick run
 * at 80, past which a "longer fence" is plain text (Codex, on the commit that sized them).
 */
export function sanitize(s: string): string {
  return shorten(s.replace(/`/g, 'ˋ').replace(/[\r\n\t]/g, ' '));
}

/**
 * The report's text in the comment: its messages, test names, paths and reasons hold the pull request's own text, which
 * the comment GitHub's token posts must never turn into HTML, a link, an image, a mention or a reference. It is never
 * read for its backticks or escaped piece by piece: the whole text, sanitised, is one code span of one backtick, the one
 * Markdown context where GitHub renders nothing (no mention, reference or autolink either). The comment has no table,
 * so a `|` stays as it is. An empty text is a span of one space: a code span cannot be empty.
 */
export function literal(s: string): string {
  const text = sanitize(s);
  return text === '' ? '` `' : `\`${text}\``;
}

/** The same text inside the folded list, an HTML block where Markdown is not read: <code>, with its HTML escaped. */
function htmlLiteral(s: string): string {
  return `<code>${shorten(s.replace(LINE_ENDING, ' ')).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</code>`;
}

/**
 * A link's destination is data too (the path is the pull request's): every character but a URL's own letters, digits
 * and `-._~:/?#[]@!$&'*+,;=%` is percent-encoded, so no parenthesis, space or angle bracket ends it (CommonMark, *Links*).
 */
function destination(url: string): string {
  const bytes = new TextEncoder();
  return url.replace(/[^A-Za-z0-9\-._~:/?#[\]@!$&'*+,;=%]/gu, (c) => [...bytes.encode(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''));
}

function location(f: Finding, link: LineLink | null): string {
  // `(base)`, as the CLI prints it: the finding is about the base side (a removed test, or a side that was not read).
  const label = `${literal(f.line === null ? f.file : `${f.file}:${f.line}`)}${f.side === 'base' ? ' (base)' : ''}`;
  const url = link ? link(f.side, f.file, f.line) : null;
  return url ? `[${label}](${destination(url)})` : label;
}

function item(f: Finding, link: LineLink | null): string[] {
  const out = [`- ${ICON[f.severity]} **${f.severity.toUpperCase()}** ${location(f, link)} — ${literal(f.message)} <sub>${f.rule}</sub>`];
  // A grouped finding (src/rules/group.ts) folds its full list of tests when it is longer than the message shows.
  if (f.tests && f.tests.length > 5) out.push(`  <details><summary>${f.tests.length} tests</summary>${f.tests.map(htmlLiteral).join('<br>')}</details>`);
  return out;
}

export function gateText(failOn: FailOn): string {
  if (failOn === 'warn') return 'this check fails only on WARN or worse (`fail-on: warn`)';
  if (failOn === 'fail') return 'this check fails only on FAIL or worse (`fail-on: fail`)';
  return 'this check does not block the merge, whatever the verdict (`fail-on` not set)';
}

/** The body of the PR comment and the job summary: what happened to the tests first, with links to the lines, then the verdict. */
export function renderComment(report: Report, options: CommentOptions): string {
  const max = options.maxLength ?? 65_000;
  const groups = GROUPS.map((g) => ({ title: g.title, findings: report.findings.filter((f) => g.rules.includes(f.rule)) })).filter((g) => g.findings.length > 0);
  const render = (shown: number): string => {
    const lines: string[] = [COMMENT_MARKER, '### saidvsdid: what this pull request does to the tests', ''];
    let left = shown;
    let hidden = 0;
    // Once, before the findings: Python test files were not read, why, and how to fix it (the runner's interpreter).
    const scopes = report.tool.scopes;
    if (scopes?.python_unavailable) lines.push(`⚠️ **Python test files were not read:** ${literal(scopes.python_unavailable)}${scopes.python_remedy ? ` — ${literal(scopes.python_remedy)}` : ''}`, '');
    // What was read of the changed test files (src/coverage.ts), before any finding: an OK never covers what is listed.
    if (report.coverage) {
      const c = report.coverage;
      lines.push(`${incomplete(c) ? '⚠️ ' : ''}**Coverage:** ${coverageCounts(c)}`, '');
      const partial = c.files.filter((f) => f.state !== 'analysed');
      for (const f of partial.slice(0, MAX_COVERAGE_FILES)) lines.push(`- ${literal(f.path)} — ${f.state === 'partly-analysed' ? 'partly analysed' : 'not analysed'}: ${literal(f.reasons.join('; '))}`);
      if (partial.length > MAX_COVERAGE_FILES) lines.push(`- and ${partial.length - MAX_COVERAGE_FILES} more`);
      if (partial.length > 0) lines.push('');
    }
    if (groups.length === 0) lines.push(report.unverifiable.length > 0 ? 'No findings in the files that could be analysed.' : 'No findings in what saidvsdid reads.', '');
    for (const g of groups) {
      lines.push(`**${g.title}**`, '');
      for (const f of g.findings) {
        if (left > 0) lines.push(...item(f, options.link));
        else hidden++;
        left--;
      }
      lines.push('');
    }
    if (hidden > 0) lines.push(`_${hidden} more finding${hidden === 1 ? '' : 's'} not shown (comment size limit): run \`npx saidvsdid check\` for the full report._`, '');
    if (report.unverifiable.length > 0) {
      lines.push('**Could not be analysed** — the verdict cannot be OK:', '');
      for (const u of report.unverifiable) lines.push(`- ${literal(u.file)} (${u.side}): ${literal(u.reason)}`);
      lines.push('');
    }
    // One line per reason: TG006 and TG007 without a transcript read as one.
    const reasons = new Map<string, RuleId[]>();
    for (const n of report.not_evaluated) reasons.set(n.reason, [...(reasons.get(n.reason) ?? []), n.rule]);
    for (const [reason, rules] of reasons) {
      const experimental = rules.every((r) => EXPERIMENTAL.has(r)) ? ' (experimental)' : '';
      lines.push(`Not evaluated: ${rules.join(', ')}${experimental} — ${literal(reason)}.`, '');
    }
    const { fail, warn, info } = report.counts;
    lines.push('---', '');
    lines.push(`**Verdict: ${verdictLabel(report)}** · ${fail} fail · ${warn} warn · ${info} info — ${gateText(options.failOn)}.`, '');
    lines.push(
      `<sub>saidvsdid ${report.tool.version} · base \`${report.repo.base.slice(0, 12)}\` → head \`${report.repo.head.slice(0, 12)}\` · ` +
        'FAIL: a fact about the code, checkable by reading it · WARN: for a human to look at · ' +
        '`npx saidvsdid explain <RULE>` says what each rule catches and what it does not</sub>',
    );
    return lines.join('\n') + '\n';
  };
  const total = report.findings.length;
  let body = render(total);
  for (let shown = total; body.length > max && shown > 0; ) {
    shown = Math.floor(shown / 2);
    body = render(shown);
  }
  return body;
}
