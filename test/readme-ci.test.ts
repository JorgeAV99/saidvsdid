// The README shows what the tool prints and what this repository runs: its example comment and CLI output are the
// renderings of fixtures/action/demo, its workflow is the Action with its default (it blocks nothing), and the CI's
// dogfood step is the same Action, from this checkout, blocking on FAIL or worse.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureRepo } from '../fixtures/build.js';
import { runCheck } from '../src/check.js';
import { COMMENT_MARKER, renderComment } from '../src/report/comment.js';
import type { Report } from '../src/report/model.js';
import { renderText } from '../src/report/text.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { repository: { url: string } };

/** The README's text between `<!-- example:NAME -->` and `<!-- /example:NAME -->`. */
function block(name: string): string {
  const start = readme.indexOf(`<!-- example:${name} -->\n`);
  const end = readme.indexOf(`<!-- /example:${name} -->`);
  expect(start, `example:${name}`).toBeGreaterThan(-1);
  expect(end, `/example:${name}`).toBeGreaterThan(start);
  return readme.slice(start + `<!-- example:${name} -->\n`.length, end);
}

const fence = (text: string, lang: string): string => {
  expect(text.startsWith(`\`\`\`${lang}\n`) && text.endsWith('```\n'), `a ${lang} code block`).toBe(true);
  return text.slice(`\`\`\`${lang}\n`.length, -'```\n'.length);
};

const tmp = mkdtempSync(join(tmpdir(), 'saidvsdid-readme-'));
let demo: Report;

beforeAll(async () => {
  const r = buildFixtureRepo(fileURLToPath(new URL('../fixtures/action/demo', import.meta.url)), join(tmp, 'demo'));
  demo = await runCheck({ repo: r.repo, base: r.base, head: r.head });
}, 120_000);

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("the README's examples are what the tool prints on fixtures/action/demo", () => {
  it('the comment, as the Action posts it (quoted, without its marker line or links)', () => {
    const body = renderComment(demo, { link: null, failOn: 'none' });
    expect(body.startsWith(`${COMMENT_MARKER}\n`)).toBe(true);
    const quoted = body
      .slice(COMMENT_MARKER.length + 1)
      .trimEnd()
      .split('\n')
      .map((l) => (l === '' ? '>' : `> ${l}`))
      .join('\n');
    expect(block('comment')).toBe(`${quoted}\n`);
  });

  it('the command line', () => {
    expect(fence(block('cli'), 'text')).toBe(renderText(demo));
  });
});

describe("the README's workflow and the CI's dogfood step", () => {
  const workflow = fence(block('workflow'), 'yaml');
  const repo = /github\.com\/([^/]+\/[^/.]+)/.exec(pkg.repository.url)![1]!;

  it('the README: on pull requests, the minimal permissions, the whole history, and the Action with its default', () => {
    expect(workflow).toContain('on: pull_request\n');
    expect(workflow).toContain('permissions:\n  contents: read\n  pull-requests: write\n\n');
    expect(workflow).toContain('- uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n');
    expect(workflow.endsWith(`      - uses: ${repo}@v0\n`)).toBe(true);
    expect(workflow).not.toMatch(/fail-on|secrets\./);
  });

  it('the CI: the same Action from this checkout, blocking on FAIL or worse, without its fixtures', () => {
    expect(ci).toMatch(/    permissions:\n      contents: read\n      pull-requests: write\n/);
    expect(ci).toContain('      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n');
    expect(ci).toContain("      - name: Check this PR\n        if: github.event_name == 'pull_request' && (success() || failure())\n        uses: ./\n        with:\n          fail-on: fail\n          exclude: fixtures/**\n");
  });

  it('how to block is the input the Action reads', () => {
    expect(readme).toContain(`      - uses: ${repo}@v0\n        with:\n          fail-on: fail   # or: warn\n`);
  });
});
