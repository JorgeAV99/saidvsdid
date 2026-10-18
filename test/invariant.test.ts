// GUARANTEE: an increase in recognised markers of any kind (skip, only, todo,
// fixme, xfail, incl. Vitest options) in a test file never ends in PASS, except a
// disabling marker (skip, todo, fixme, xfail) on tests that did not exist at base:
// nothing that existed is lost, and the report names each one in an INFO line
// (reason `new_test`). An OK is accepted only when every added marker stands on a
// line the report names so; a focus always counts.
// "Recognised" is the product's own vocabulary (src/rules/net.ts); this test
// checks the whole pipeline honours it on every fixture and on seeded random
// marker insertions. Independent grounding comes from test/runner-evidence.test.ts,
// which checks fixtures against what the real runner executes.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { listCases } from '../fixtures/build.js';
import { analyze } from '../src/check.js';
import type { FileChange } from '../src/git/diff.js';
import { isLooseTestPath, isTestPath } from '../src/parse/index.js';
import { contagionUses, newUses, type ContagionUse } from '../src/rules/contagion.js';
import { countMarkers } from '../src/rules/net.js';
import type { Report } from '../src/report/model.js';

function readTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    let entries: string[] = [];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries.sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p).replace(/\\/g, '/'), readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

const isCandidate = (p: string): boolean => isTestPath(p) || isLooseTestPath(p);
const testFiles = (tree: Map<string, string>): Map<string, string> => new Map([...tree].filter(([p]) => isCandidate(p)));

function changesBetween(base: Map<string, string>, head: Map<string, string>): FileChange[] {
  const paths = [...new Set([...base.keys(), ...head.keys()])].sort();
  const out: FileChange[] = [];
  for (const p of paths) {
    const b = base.get(p);
    const h = head.get(p);
    if (b === h) continue;
    out.push({ status: b === undefined ? 'A' : h === undefined ? 'D' : 'M', basePath: b === undefined ? null : p, headPath: h === undefined ? null : p });
  }
  return out;
}

async function reportOf(base: Map<string, string>, head: Map<string, string>): Promise<Report> {
  return analyze({
    base: '0'.repeat(40),
    head: '1'.repeat(40),
    changes: changesBetween(base, head),
    read: (side, path) => (side === 'base' ? base : head).get(path) ?? null,
  });
}

async function verdictOf(base: Map<string, string>, head: Map<string, string>): Promise<string> {
  return (await reportOf(base, head)).verdict;
}

/** The lines the report names as disabling markers on tests that did not exist at base, by head path. */
function newTestLines(report: Report): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const f of report.findings) {
    if (f.reason !== 'new_test' || f.severity !== 'info' || f.line === null) continue;
    out.set(f.file, (out.get(f.file) ?? new Set()).add(f.line));
  }
  return out;
}

/** Whether a report that would exit 0 honours the guarantee: every added marker stands on a line it names as a new test's. */
async function okIsExplained(base: Map<string, string>, head: Map<string, string>, report: Report): Promise<boolean> {
  const lines = newTestLines(report);
  return lines.size > 0 && !(await oracleSaysAdded(base, head, lines));
}

/**
 * Some test file has more markers of some kind at head than at base (same path, the count net), or a
 * new use of the vocabulary (the contagion net: a call, decorator or raise of a token or a marked name).
 */
async function oracleSaysAdded(base: Map<string, string>, head: Map<string, string>, exempt: ReadonlyMap<string, ReadonlySet<number>> = new Map()): Promise<boolean> {
  for (const [path, source] of head) {
    // `exempt`: lines named as disabling markers on new tests; a focus is counted on them all the same.
    const skip = exempt.get(path);
    const all = await countMarkers(path, source);
    const after = skip ? await countMarkers(path, source, skip) : all;
    const before = base.has(path) ? await countMarkers(path, base.get(path)!) : null;
    for (const kind of Object.keys(all) as (keyof typeof all)[]) {
      if ((kind === 'only' ? all[kind] : after[kind]) > (before?.[kind] ?? 0)) return true;
    }
    // Counted per callee and form, whatever test they stand in (a renamed test adds nothing).
    const anyTest = async (text: string): Promise<ContagionUse[]> => (await contagionUses(path, text, [])).map((u) => ({ ...u, test: null }));
    // Uses on an exempt line are left out before counting (uses are matched by callee, not by line).
    const headUses = (await anyTest(source)).filter((u) => !skip?.has(u.line) || [...u.mark.kinds].includes('only'));
    if (newUses(base.has(path) ? await anyTest(base.get(path)!) : [], headUses).length > 0) return true;
  }
  return false;
}

const cases = listCases();

describe('invariant on every fixture', () => {
  it.each(cases.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const base = readTree(join(c.dir, 'base'));
    const head = readTree(join(c.dir, 'head'));
    if (!(await oracleSaysAdded(testFiles(base), testFiles(head)))) return;
    // Never exit 0 (neither a PASS nor an OK), unless every added marker is a disabling one on a new test the report names.
    const report = await reportOf(base, head);
    expect(c.expect.verdict).not.toBe('PASS');
    expect(report.verdict).not.toBe('PASS');
    // The diff alone (no transcript here): an OK, and an expected OK, only with every added marker on a new test it names.
    if (report.verdict === 'OK') expect(await okIsExplained(testFiles(base), testFiles(head), report), 'every added marker is on a new test the report names').toBe(true);
    if (c.expect.verdict === 'OK') expect(report.verdict).toBe('OK');
  });

  it('the oracle is not vacuous: it fires on most positive fixtures', async () => {
    let fired = 0;
    for (const c of cases) {
      if (await oracleSaysAdded(testFiles(readTree(join(c.dir, 'base'))), testFiles(readTree(join(c.dir, 'head'))))) fired++;
    }
    expect(fired).toBeGreaterThan(25);
  });
});

describe('invariant on one-step aliases and Unicode names', () => {
  const T = String.fromCharCode(0x505c);
  const S = String.fromCharCode(0x17f);
  // A new use of an alias whose definition does not change, in any scope, with Unicode names.
  it.each([
    ['py: `@omit` at module level', 'test_a.py', 'import pytest\n\nomit = pytest.mark.skip\n\n\n@omit\ndef test_a():\n    pass\n\n\ndef test_b():\n    pass\n', 'import pytest\n\nomit = pytest.mark.skip\n\n\n@omit\ndef test_a():\n    pass\n\n\n@omit\ndef test_b():\n    pass\n'],
    ['py: an alias of a call', 'test_a.py', 'import sys\nimport pytest\n\nwin = pytest.mark.skipif(sys.platform == "win32", reason="x")\n\n\ndef test_b():\n    pass\n', 'import sys\nimport pytest\n\nwin = pytest.mark.skipif(sys.platform == "win32", reason="x")\n\n\n@win\ndef test_b():\n    pass\n'],
    ['py: an alias in a class body', 'test_a.py', 'import pytest\n\n\nclass TestA:\n    omit = pytest.mark.skip\n\n    def test_b(self):\n        pass\n', 'import pytest\n\n\nclass TestA:\n    omit = pytest.mark.skip\n\n    @omit\n    def test_b(self):\n        pass\n'],
    ['py: an alias of `pytest.skip` in the test', 'test_a.py', 'import pytest\n\n\ndef test_b():\n    now = pytest.skip\n', 'import pytest\n\n\ndef test_b():\n    now = pytest.skip\n    now("x")\n'],
    ['py: a Unicode alias of SkipTest in the test', 'test_a.py', `import unittest\n\n\nclass TestA(unittest.TestCase):\n    def test_b(self):\n        from unittest import SkipTest as ${T}\n`, `import unittest\n\n\nclass TestA(unittest.TestCase):\n    def test_b(self):\n        from unittest import SkipTest as ${T}\n        raise ${T}("x")\n`],
    ['py: an alias of SkipTest raised', 'test_a.py', 'import unittest\n\nStop = unittest.SkipTest\n\n\ndef test_b():\n    pass\n', 'import unittest\n\nStop = unittest.SkipTest\n\n\ndef test_b():\n    raise Stop("x")\n'],
    ['py: `pyteſt.skip()` (NFKC)', 'test_a.py', 'import pytest\n\n\ndef test_b():\n    pass\n', `import pytest\n\n\ndef test_b():\n    pyte${S}t.skip("x")\n`],
    ['py: `raise (unittest.SkipTest)`', 'test_a.py', 'import unittest\n\n\ndef test_b():\n    pass\n', 'import unittest\n\n\ndef test_b():\n    raise (unittest.SkipTest)\n'],
    ['py: `@(omit)`', 'test_a.py', 'import pytest\n\nomit = pytest.mark.skip\n\n\ndef test_b():\n    pass\n', 'import pytest\n\nomit = pytest.mark.skip\n\n\n@(omit)\ndef test_b():\n    pass\n'],
    ['py: a walrus alias', 'test_a.py', 'import pytest\n\n(omit := pytest.mark.skip)\n\n\ndef test_b():\n    pass\n', 'import pytest\n\n(omit := pytest.mark.skip)\n\n\n@omit\ndef test_b():\n    pass\n'],
    ['py: an unpacking alias', 'test_a.py', 'import pytest\n\n(omit,) = (pytest.mark.skip,)\n\n\ndef test_b():\n    pass\n', 'import pytest\n\n(omit,) = (pytest.mark.skip,)\n\n\n@omit\ndef test_b():\n    pass\n'],
    ['py: a for alias', 'test_a.py', 'import pytest\n\nfor omit in (pytest.mark.skip,):\n    pass\n\n\ndef test_b():\n    pass\n', 'import pytest\n\nfor omit in (pytest.mark.skip,):\n    pass\n\n\n@omit\ndef test_b():\n    pass\n'],
    ['py: `__class__()` in a method (the import is elsewhere)', 'test_a.py', 'from pytest import skip as __class__\n\n\nclass TestA:\n    def test_b(self):\n        pass\n', 'from pytest import skip as __class__\n\n\nclass TestA:\n    def test_b(self):\n        __class__()\n'],
    ['js: a destructured member', 'a.test.ts', "import { it } from 'vitest';\nconst { skip } = it;\nit('b', () => {});\n", "import { it } from 'vitest';\nconst { skip } = it;\nskip('b', () => {});\n"],
    ['js: an alias through `as` and `!`', 'a.test.ts', "import { it } from 'vitest';\nconst omit = (it.skip as typeof it.skip)!;\nit('b', () => {});\n", "import { it } from 'vitest';\nconst omit = (it.skip as typeof it.skip)!;\nomit('b', () => {});\n"],
    ['js: `(it as any).skip`', 'a.test.ts', "import { it } from 'vitest';\nit('b', () => {});\n", "import { it } from 'vitest';\n(it as any).skip('b', () => {});\n"],
    ['js: `omit(…)` at module level', 'a.test.ts', "import { test } from 'vitest';\nconst omit = test.skip;\nomit('a', () => {});\ntest('b', () => {});\n", "import { test } from 'vitest';\nconst omit = test.skip;\nomit('a', () => {});\nomit('b', () => {});\n"],
    ['js: an alias in a describe callback', 'a.test.ts', "import { describe, it } from 'vitest';\ndescribe('s', () => {\n  const solo = it.only;\n  it('b', () => {});\n});\n", "import { describe, it } from 'vitest';\ndescribe('s', () => {\n  const solo = it.only;\n  solo('b', () => {});\n});\n"],
    ['js: an alias of `skipIf(c)`', 'a.test.ts', "import { it } from 'vitest';\nconst win = it.skipIf(process.platform === 'win32');\nit('b', () => {});\n", "import { it } from 'vitest';\nconst win = it.skipIf(process.platform === 'win32');\nwin('b', () => {});\n"],
  ] as const)('%s', async (_why, path, base, head) => {
    const b = new Map([[path, base]]);
    const h = new Map([[path, head]]);
    expect(await oracleSaysAdded(b, h), 'the nets count the new use').toBe(true);
    expect(['PASS', 'OK']).not.toContain(await verdictOf(b, h));
  });
});

// --- mutations -------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const TS_SNIPPETS = [
  'test.skip();',
  'test.fixme();',
  'test.fail();',
  'ctx.skip();',
  "it.only('mutant', () => {});",
  "it.skip('mutant', () => {});",
  "it.todo('mutant');",
  "it.fails('mutant', () => {});",
  "fit('mutant', () => {});",
  "xit('mutant', () => {});",
  "describe.only('mutant', () => { it('m', () => {}); });",
  "it.skipIf(false)('mutant', () => {});",
  "it.runIf(true)('mutant', () => {});",
  'if (false) { test.skip(); }',
  'function mutantHelper() { test.skip(); }',
  'const mutantObj = { m() { test.skip(); } };',
  'test.beforeEach(function mutantHook() { test.skip(); });',
  '[0].forEach(() => test.skip());',
  "it['skip']('mutant', () => {});",
  "test['only']('mutant', () => {});",
  "ctx['skip']();",
];

const PY_STATEMENTS = [
  'pytest.skip("mutant")',
  'pytest.xfail("mutant")',
  'self.skipTest("mutant")',
  'pytest.importorskip("mutant")',
  'pytestmark = pytest.mark.skip',
  'if False:\n{i}    pytest.skip("mutant")',
  'def _mutant():\n{i}    pytest.skip("mutant")',
];
const PY_DECORATORS = [
  '@pytest.mark.skip',
  '@pytest.mark.xfail(strict=True)',
  '@pytest.mark.only',
  '@unittest.skip("mutant")',
  '@pytest.mark.skipif(sys.platform == "win32", reason="mutant")',
];

const TS_STATEMENT_START = /^(?:it|test|describe|expect|fit|xit)\b|^(?:await|const|let|import|return)\s|^\}/;

/** Candidate insertion lines for `snippet`, or [] if none fits. */
function slots(lines: string[], py: boolean, decorator: boolean): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t === '') return;
    if (!py) {
      if (TS_STATEMENT_START.test(t)) out.push(i);
      return;
    }
    const prev = lines.slice(0, i).reverse().find((x) => x.trim() !== '')?.trimEnd() ?? '';
    if (/[([{,\\:]$/.test(prev) && !prev.endsWith(':')) return; // continuation line
    if (/^[)\]}]|^(?:else|elif|except|finally)\b/.test(t)) return;
    if (decorator) {
      if (/^(?:def|class|@)/.test(t)) out.push(i);
    } else if (!prev.trimStart().startsWith('@')) {
      out.push(i);
    }
  });
  return out;
}

function mutate(source: string, py: boolean, rand: () => number): { source: string; snippet: string } | null {
  const lines = source.split('\n');
  const decorator = py && rand() < 0.4;
  const pool = py ? (decorator ? PY_DECORATORS : PY_STATEMENTS) : TS_SNIPPETS;
  const candidates = slots(lines, py, decorator);
  if (candidates.length === 0) return null;
  const at = candidates[Math.floor(rand() * candidates.length)]!;
  const indent = /^\s*/.exec(lines[at]!)![0];
  const snippet = pool[Math.floor(rand() * pool.length)]!;
  const text = indent + snippet.replace(/\{i\}/g, indent);
  return { source: [...lines.slice(0, at), text, ...lines.slice(at)].join('\n'), snippet };
}

const MUTATIONS_PER_FILE = 8;

describe('invariant on random marker insertions', () => {
  const targets: { id: string; files: Map<string, string>; path: string }[] = [];
  for (const c of cases) {
    const files = readTree(join(c.dir, 'head'));
    for (const path of files.keys()) {
      if (isCandidate(path)) targets.push({ id: `${c.id}:${path}`, files, path });
    }
  }

  // The insertions are analysed in the hook, under its own limit (their number grows with the fixtures); the test reads
  // what it found.
  const found = { total: 0, unverifiable: 0, newTests: 0, violations: [] as string[] };
  beforeAll(async () => {
    for (const t of targets) {
      const rand = mulberry32(hash(t.id));
      for (let k = 0; k < MUTATIONS_PER_FILE; k++) {
        const m = mutate(t.files.get(t.path)!, t.path.endsWith('.py'), rand);
        if (!m) continue;
        const head = new Map(t.files);
        head.set(t.path, m.source);
        // Sanity: the oracle must agree that a marker was added.
        if (!(await oracleSaysAdded(testFiles(t.files), testFiles(head)))) continue;
        found.total++;
        const report = await reportOf(t.files, head);
        const verdict: string = report.verdict;
        if (verdict === 'UNVERIFIABLE') found.unverifiable++;
        if (verdict === 'OK' && (await okIsExplained(testFiles(t.files), testFiles(head), report))) found.newTests++;
        else if (verdict === 'PASS' || verdict === 'OK') found.violations.push(`${t.id} +${JSON.stringify(m.snippet)}`);
      }
    }
  }, 900_000);

  it(`never PASSes when a marker is inserted (${MUTATIONS_PER_FILE} seeded mutations per fixture test file)`, () => {
    expect(found.violations).toEqual([]);
    expect(found.total).toBeGreaterThan(300);
    // Most insertions land in an existing test (or are a focus): the exception must not swallow the property.
    expect(found.newTests / found.total).toBeLessThan(0.5);
    // Most insertions must produce valid code, or the property is vacuous.
    expect(found.unverifiable / found.total).toBeLessThan(0.2);
  });
});
