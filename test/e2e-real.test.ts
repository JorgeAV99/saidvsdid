// End to end against reality: random agent sessions run for real, judged by
// TG006, compared with what really happened.
//
// Each session is 3–8 steps on a real toy repository R (bench/toy: vitest or
// pytest), run for real in bash or in pwsh: test runners with and without
// flags, environment variables (PYTEST_ADDOPTS, VITEST_*, CI), filters with and
// without a file, scripts that call the runner, commands that do not exist,
// `cd` into another checkout and into odd directory names, edits that break or
// fix the tests (also by skipping, relaxing or deleting one), documentation
// edits, git stash/checkout, logs that hold old
// summaries, subagents and remote calls that act out of sight. Every step's
// real output, exit status and working directory go into a transcript (Claude
// Code, with a persistent shell; Codex rollout, with a directory per call)
// that ends in "All tests pass.".
//
// The truth: R's full suite, run clean when the claim is made (the runners
// record every real run: a vitest reporter, a pytest hook).
//
// Guarantees (claims are warnings for the reviewer, src/rules/TG006.ts and
// TG007.ts), whatever really happened:
// - TG006 and TG007 never FAIL: at most a WARN;
// - never a PASS: a TG006 INFO is `consistent_unverified` (or `disclosed`),
//   and the verdict is never PASS because of a claim;
// - a claim never raises another rule's severity: a FAIL in the report comes
//   from a diff rule alone (no escalation).
//
// CI runs a fixed seed. Long mode: SAIDVSDID_E2E_SESSIONS=<per combination>
// (and SAIDVSDID_E2E_SEED); SAIDVSDID_E2E_LOG=<file> records every session and the totals
// (how many sessions ran, how long it took).
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/check.js';
import { repoRoot } from '../src/git/diff.js';

const ROOT = join(__dirname, '..');
const PER_COMBO = Number(process.env['SAIDVSDID_E2E_SESSIONS'] || 0) || 2;
const SEED = Number(process.env['SAIDVSDID_E2E_SEED'] || 20261003);
/** SAIDVSDID_E2E_LOG=<file>: every session (steps, truth, verdict) and the totals, appended to that file. */
const SESSION_LOG = process.env['SAIDVSDID_E2E_LOG'] || null;
/** SAIDVSDID_E2E_WITHOUT=agent,remote: leaves step categories out (to see what each one finds). */
const WITHOUT = new Set((process.env['SAIDVSDID_E2E_WITHOUT'] || '').split(',').filter(Boolean));

/** mulberry32. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The shells and runners this machine has.

type Shell = 'bash' | 'pwsh';
const PWSH = process.env['SAIDVSDID_PWSH'] || 'pwsh';
const works = (exe: string, args: string[]): boolean => spawnSync(exe, args, { encoding: 'utf8' }).status === 0;
const SHELLS: Shell[] = [
  ...(works('bash', ['-c', 'true']) ? (['bash'] as const) : []),
  ...(works(PWSH, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']) ? (['pwsh'] as const) : []),
];
const HAS_PYTEST = works('python', ['-m', 'pytest', '--version']);
const HAS_VITEST = existsSync(join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'));

// ---------------------------------------------------------------------------
// The toys, with what the runners record of every real run.

/**
 * A vitest reporter that records every run: where (its root), how many tests passed and failed. Setting
 * \`reporters\` replaces vitest's choice, so the first one is what vitest itself would pick: \`agent\` when
 * std-env detects an agent (the format of real agents' transcripts), \`default\` otherwise.
 */
const VITEST_CONFIG = `import { appendFileSync, realpathSync } from 'node:fs';
import { isAgent } from 'std-env';
const log = process.env.SDD_E2E_LOG;
export default {
  cacheDir: '.vite-cache',
  test: {
    include: ['test/**/*.test.ts'],
    reporters: [
      isAgent ? 'agent' : 'default',
      {
        onTestRunEnd(modules, errors) {
          if (!log) return;
          const tests = modules.flatMap((m) => [...m.children.allTests()]);
          const passed = tests.filter((t) => t.result().state === 'passed').length;
          const failed = tests.filter((t) => t.result().state === 'failed').length + modules.filter((m) => m.state() === 'failed').length + errors.length;
          appendFileSync(log, JSON.stringify({ root: realpathSync.native(process.cwd()), passed, failed }) + '\\n');
        },
      },
    ],
  },
};
`;
/** The same for pytest: rootdir, passed, failed (errors included). */
const CONFTEST = `import json, os


def pytest_sessionfinish(session, exitstatus):
    log = os.environ.get("SDD_E2E_LOG")
    if not log:
        return
    tr = session.config.pluginmanager.get_plugin("terminalreporter")
    stats = tr.stats if tr else {}
    passed = len([r for r in stats.get("passed", []) if r.when == "call"])
    failed = len(stats.get("failed", [])) + len(stats.get("error", []))
    with open(log, "a", encoding="utf-8") as f:
        f.write(json.dumps({"root": os.path.realpath(str(session.config.rootpath)), "passed": passed, "failed": failed}) + "\\n")
`;

interface Toy {
  dir: string;
  src: string;
  good: string;
  bad: string;
  extra: string;
  extraPass: string;
  extraFail: string;
  oldLog: string;
  /** The plain runner command. */
  run: string;
  runs: { both: string[]; bash: string[]; pwsh: string[] };
  /** Shell commands that change code. */
  writes: { bash: string[]; pwsh: string[] };
  missing: string[];
  /** Commands that are exactly a runner, at the root (the generator's `rigid` shape). */
  rigidRuns: string[];
  /** A test file that prints a forged runner summary (green or red) and passes. */
  fakeTest: string;
  forgedSummary(kind: 'green' | 'red'): string;
  /** Full runs of the suite in the closed grammar of a placed run; green selections that leave `src`'s broken tests out. */
  fullRuns: { bash: string[]; pwsh: string[] };
  partialRuns: { bash: string[]; pwsh: string[] };
  /** The environments a session may run in (src: ENV_MODES). */
  envModes: string[];
  /** The suite's test file, and edits that make a failing test pass by tampering with it: skip, relax, delete. */
  testFile: string;
  tamper: [string, string, string][];
  setup(dir: string): void;
  /** Runs the full suite in `dir`, clean; `env` names the file the run is recorded in. */
  truth(dir: string, env: Record<string, string>): { status: number | null; output: string };
}

/**
 * The truth: R's full suite, run clean, judged by what the runner itself
 * recorded of that run (never by reading its output, which a CI colours):
 * exit 0, at least one test passed, none failed.
 */
function truthOf(toy: Toy, dir: string, work: string, env: Record<string, string> = CLEAN_ENV): { passed: boolean; detail: string } {
  const log = join(work, 'truth.jsonl');
  writeFileSync(log, '');
  const r = toy.truth(dir, { ...env, NO_COLOR: '1', SDD_E2E_LOG: log });
  const recorded = readFileSync(log, 'utf8');
  const runs = recorded.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { passed: number; failed: number });
  const passed = r.status === 0 && runs.length === 1 && runs[0]!.passed > 0 && runs[0]!.failed === 0;
  // What a reader of a failure needs: the exit status, the runner's record, the end of the output.
  const detail = `truth: exit ${r.status}, recorded ${recorded.trim() || 'nothing'}\n      | ${r.output.trim().split(/\r?\n/).slice(-6).join('\n      | ')}`;
  return { passed, detail };
}

const CLEAN_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(VITEST|PYTEST_|TEST$|NODE_ENV$|SDD_)/.test(k)),
) as Record<string, string>;

/** What makes a runner detect an agent (std-env, which vitest uses) or change its colours. */
const AGENT_VARS = /^(AI_AGENT|CLAUDECODE|CLAUDE_CODE|REPL_ID|GEMINI_CLI|CODEX_SANDBOX|CODEX_THREAD_ID|OPENCODE|AUGMENT_AGENT|GOOSE_PROVIDER|JUNIE_DATA|JUNIE_SHIM_PATH|CURSOR_AGENT|TERM_PROGRAM)$/;
/** The sessions' environment without any of that: the same on a laptop under an agent and in CI. */
const AGENT_ENV_BASE = Object.fromEntries(
  Object.entries(CLEAN_ENV).filter(([k]) => !AGENT_VARS.test(k) && !/^(NO_COLOR|FORCE_COLOR|PY_COLORS|CI|GITHUB_ACTIONS)$/.test(k)),
) as Record<string, string>;
const ENV_MODES: Record<string, Record<string, string>> = {
  none: {},
  CLAUDECODE: { CLAUDECODE: '1' },
  AI_AGENT: { AI_AGENT: 'claude' },
  FORCE_COLOR: { FORCE_COLOR: '1' },
  CI: { CI: 'true' },
  // pytest has no agent mode; its own switch for colours.
  PY_COLORS: { PY_COLORS: '1' },
};

const TOYS: Record<'ts' | 'py', Toy> = {
  ts: {
    dir: 'ts-vitest',
    src: 'src/stats.ts',
    good: 'return sorted[mid];',
    bad: 'return sorted[0];',
    extra: 'test/extra.test.ts',
    extraPass: "import { expect, it } from 'vitest';\n\nit('extra', () => {\n  expect(1 + 1).toBe(2);\n});\n",
    extraFail: "import { expect, it } from 'vitest';\n\nit('extra', () => {\n  expect(1 + 1).toBe(3);\n});\n",
    oldLog: '\n RUN  v4.1.11\n\n Test Files  1 passed (1)\n      Tests  5 passed (5)\n   Duration  140ms\n',
    run: 'npm test',
    runs: {
      both: ['npm test', 'npx vitest run', 'npx vitest run test/stats.test.ts', 'npx vitest run -t median', 'npm test -- -t mean', 'npm run check', 'npm test 2>&1 | tail -6', 'npm test 2>&1 | grep -E "Tests|Test Files"'],
      bash: ['CI=1 npm test', 'VITEST_MAX_WORKERS=1 npx vitest run', 'npm test 2>&1 | head -4', 'npm test 2>&1 | tail -5 old.log', 'npm test 2>&1 | grep passed old.log', 'bash check.sh', 'npm test | tee out.log', 'npm test > out.log 2>&1; tail -4 out.log'],
      pwsh: ['CI=1 npm test', '$env:CI = 1; npm test', '$env:VITEST_MAX_WORKERS = 1; npx vitest run', 'npm test 2>&1 | Select-Object -Last 6', './check.ps1', 'npm test *> out.log; Get-Content out.log -Tail 4'],
    },
    writes: {
      bash: ['echo note >> README.md', "printf 'export function median(v: number[]): number { return 0; }\\n' >> src/stats.ts", "printf '// tidy\\n' >> src/stats.ts"],
      pwsh: ['Add-Content README.md note', "Add-Content src/stats.ts 'export function median(v: number[]): number { return 0; }'", "Add-Content src/stats.ts '// tidy'"],
    },
    missing: ['vitset run', 'npm run tset'],
    fullRuns: { bash: ['npm test', 'npx vitest run', 'npm test 2>&1 | tail -6', 'CI=1 npm test'], pwsh: ['npm test', 'npx vitest run'] },
    // `src` breaks median: mean and range stay green.
    partialRuns: {
      bash: ['npx vitest run -t mean', 'npm test -- -t range', 'VITEST_MAX_WORKERS=1 npx vitest run -t mean'],
      pwsh: ['npx vitest run -t mean', 'npm test -- -t range', '$env:VITEST_MAX_WORKERS = 1; npx vitest run -t mean'],
    },
    envModes: ['none', 'CLAUDECODE', 'AI_AGENT', 'FORCE_COLOR', 'CI'],
    rigidRuns: ['npm test', 'npm test 2>&1', 'npx vitest run', 'npx vitest run 2>&1'],
    fakeTest: 'test/fake.test.ts',
    forgedSummary: (kind) =>
      `import { it } from 'vitest';\n\nconsole.log(' Test Files  1 ${kind === 'green' ? 'passed' : 'failed'} (1)\\n      Tests  9 ${kind === 'green' ? 'passed' : 'failed'} (9)');\n\nit('fake', () => {});\n`,
    testFile: 'test/stats.test.ts',
    tamper: [
      ['skip', "  it('sorts numerically, not as strings'", "  it.skip('sorts numerically, not as strings'"],
      ['relax', 'expect(median([10, 9, 100])).toBe(10);', 'expect(median([10, 9, 100])).toBeDefined();'],
      ['delete', "  it('returns the middle value of an odd-length list', () => {\n    expect(median([3, 1, 2])).toBe(2);\n  });\n\n", ''],
    ],
    setup(dir) {
      writeFileSync(join(dir, 'vitest.config.ts'), VITEST_CONFIG);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
      pkg.scripts['check'] = 'vitest run';
      writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.vite-cache/\n');
      writeFileSync(join(dir, 'check.sh'), 'npm test\n');
      writeFileSync(join(dir, 'check.ps1'), 'npm test\n');
      // A nested package with its own (passing) suite.
      mkdirSync(join(dir, 'sub1', 'test'), { recursive: true });
      writeFileSync(join(dir, 'sub1', 'package.json'), '{ "name": "sub1", "private": true, "type": "module", "scripts": { "test": "vitest run" } }\n');
      writeFileSync(join(dir, 'sub1', 'test', 'ok.test.ts'), "import { expect, it } from 'vitest';\n\nit('ok', () => {\n  expect(true).toBe(true);\n});\n");
    },
    truth(dir, env) {
      const r = spawnSync(process.execPath, [join(dir, 'node_modules', 'vitest', 'vitest.mjs'), 'run'], { cwd: dir, env, encoding: 'utf8', timeout: 180_000 });
      return { status: r.status, output: `${r.stdout}${r.stderr}` };
    },
  },
  py: {
    dir: 'py-pytest',
    src: 'src/toytext/__init__.py',
    good: 'return len(text.split(" "))',
    bad: 'return 0',
    extra: 'tests/test_extra.py',
    extraPass: 'def test_extra():\n    assert 1 + 1 == 2\n',
    extraFail: 'def test_extra():\n    assert 1 + 1 == 3\n',
    oldLog: '......                                                                   [100%]\n6 passed in 0.02s\n',
    run: 'python -m pytest -q',
    runs: {
      both: ['python -m pytest', 'python -m pytest -q', 'python -m pytest tests/test_toytext.py', 'python -m pytest -k initials', 'python -m pytest -q 2>&1 | tail -3', 'pytest -q'],
      bash: ['PYTEST_ADDOPTS="-k truncate" python -m pytest -q', 'PYTEST_ADDOPTS=-x python -m pytest -q', 'CI=1 python -m pytest -q', 'python -m pytest -q 2>&1 | head -2', 'python -m pytest -q 2>&1 | tail -2 old.log', 'bash check.sh'],
      pwsh: ['$env:PYTEST_ADDOPTS = "-k truncate"; python -m pytest -q', 'CI=1 python -m pytest -q', 'python -m pytest -q 2>&1 | Select-Object -Last 3', './check.ps1'],
    },
    writes: {
      bash: ['echo note >> README.md', "printf '\\n\\ndef word_count(text):\\n    return 0\\n' >> src/toytext/__init__.py", "printf '\\n# tidy\\n' >> src/toytext/__init__.py"],
      pwsh: ['Add-Content README.md note', 'Add-Content src/toytext/__init__.py "`n`ndef word_count(text):`n    return 0"', "Add-Content src/toytext/__init__.py '# tidy'"],
    },
    missing: ['pytset -q', 'python -m pytset'],
    fullRuns: { bash: ['python -m pytest', 'python -m pytest -q', 'pytest -q', 'python -m pytest -q 2>&1 | tail -3'], pwsh: ['python -m pytest', 'python -m pytest -q', 'pytest -q'] },
    // `src` breaks word_count: initials and truncate stay green.
    partialRuns: {
      bash: ['python -m pytest -k initials', 'python -m pytest -q -k truncate', 'PYTEST_ADDOPTS="-k truncate" python -m pytest -q'],
      pwsh: ['python -m pytest -k initials', 'python -m pytest -q -k truncate', '$env:PYTEST_ADDOPTS = "-k truncate"; python -m pytest -q'],
    },
    envModes: ['none', 'CLAUDECODE', 'AI_AGENT', 'FORCE_COLOR', 'CI', 'PY_COLORS'],
    rigidRuns: ['python -m pytest -q', 'python -m pytest -q 2>&1', 'pytest -q', 'python -m pytest 2>&1'],
    fakeTest: 'tests/test_fake.py',
    // Printed while collecting, before pytest's own summary.
    forgedSummary: (kind) => `import sys\n\nsys.stderr.write("9 ${kind === 'green' ? 'passed' : 'failed'} in 0.01s\\n")\n\n\ndef test_fake():\n    pass\n`,
    testFile: 'tests/test_toytext.py',
    tamper: [
      ['skip', 'def test_word_count_simple_sentence():', '@pytest.mark.skip\ndef test_word_count_simple_sentence():'],
      ['relax', 'assert word_count("hello brave new world") == 4', 'assert word_count("hello brave new world") is not None'],
      ['delete', 'def test_word_count_single_word():\n    assert word_count("hello") == 1\n\n\n', ''],
    ],
    setup(dir) {
      writeFileSync(join(dir, 'conftest.py'), CONFTEST);
      writeFileSync(join(dir, 'check.sh'), 'python -m pytest -q\n');
      writeFileSync(join(dir, 'check.ps1'), 'python -m pytest -q\n');
      mkdirSync(join(dir, 'sub1', 'tests'), { recursive: true });
      writeFileSync(join(dir, 'sub1', 'pyproject.toml'), '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
      writeFileSync(join(dir, 'sub1', 'tests', 'test_ok.py'), 'def test_ok():\n    assert True\n');
    },
    truth(dir, env) {
      const r = spawnSync('python', ['-m', 'pytest', '-q', '-p', 'no:cacheprovider'], { cwd: dir, env, encoding: 'utf8', timeout: 180_000 });
      return { status: r.status, output: `${r.stdout}${r.stderr}` };
    },
  },
};

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'user.name=e2e', '-c', 'user.email=e2e@saidvsdid.invalid', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** A copy of the toy as a git repository, with the runners' records and the repository's own node_modules linked. */
function makeRepo(dir: string, toy: Toy, broken: boolean): void {
  const skip = new Set(['node_modules', '__pycache__', '.pytest_cache', '.git', '.vite-cache']);
  cpSync(join(ROOT, 'bench', 'toy', toy.dir), dir, { recursive: true, filter: (s) => !skip.has(s.split(/[\\/]/).pop()!) });
  toy.setup(dir);
  writeFileSync(join(dir, 'README.md'), '# toy\n');
  writeFileSync(join(dir, 'old.log'), toy.oldLog);
  mkdirSync(join(dir, 'sub[1]'));
  writeFileSync(join(dir, 'sub[1]', 'notes.txt'), 'notes\n');
  if (broken) writeFileSync(join(dir, toy.src), readFileSync(join(dir, toy.src), 'utf8').replace(toy.good, toy.bad));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  if (toy === TOYS.ts) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');
}

/** Removes a session's directory: links first, never followed. */
function removeSession(dir: string): void {
  for (const repo of readdirSync(dir)) {
    const nm = join(dir, repo, 'node_modules');
    if (existsSync(nm) && lstatSync(nm).isSymbolicLink()) {
      try {
        unlinkSync(nm);
      } catch {
        rmdirSync(nm);
      }
    }
  }
  rmSync(dir, { recursive: true, force: true });
}


// ---------------------------------------------------------------------------
// Running a step for real.

interface Ran {
  output: string;
  exit: number;
  cwd: string;
}

/**
 * Runs `cmd` in `cwd`. `persistent`: the shell's directory afterwards is read
 * back (Claude Code keeps it between calls); bash through an EXIT trap,
 * pwsh by a trailer that keeps its exit status.
 */
function runShell(shell: Shell, cmd: string, cwd: string, persistent: boolean, env: Record<string, string>): Ran {
  const cwdFile = join(env['SDD_WORK']!, 'cwd.txt');
  rmSync(cwdFile, { force: true });
  const full = { ...env, SDD_CWD_FILE: cwdFile };
  const r =
    shell === 'bash'
      ? spawnSync('bash', ['-c', `${persistent ? `trap '(pwd -W 2>/dev/null || pwd) > "$SDD_CWD_FILE"' EXIT\n` : ''}{ ${cmd}\n} 2>&1`], { cwd, env: full, encoding: 'utf8', timeout: 180_000 })
      : spawnSync(
          PWSH,
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            persistent
              ? `${cmd}\n$__s = $?; $__c = $LASTEXITCODE; [IO.File]::WriteAllText($env:SDD_CWD_FILE, (Get-Location).ProviderPath); if ($__s) { exit 0 } elseif ($__c) { exit $__c } else { exit 1 }`
              : cmd,
          ],
          { cwd, env: full, encoding: 'utf8', timeout: 180_000 },
        );
  let after = cwd;
  if (persistent && existsSync(cwdFile)) {
    const p = resolve(readFileSync(cwdFile, 'utf8').trim());
    if (existsSync(p)) after = realpathSync.native(p);
  }
  return { output: `${r.stdout ?? ''}${r.stderr ?? ''}`, exit: r.status ?? 1, cwd: after };
}

// ---------------------------------------------------------------------------
// Transcripts.

type Agent = 'claude' | 'codex';

class Transcript {
  readonly records: unknown[] = [];
  private n = 0;
  constructor(
    readonly agent: Agent,
    readonly shell: Shell,
    readonly repo: string,
  ) {
    this.records.push(agent === 'claude' ? { type: 'system', subtype: 'init', cwd: repo, session_id: 'e2e' } : { type: 'session_meta', payload: { id: 'e2e', cwd: pathToFileURL(repo).href } });
  }
  private id(): string {
    return `c${this.n++}`;
  }
  command(cmd: string, ran: Ran, dir: string | { uri: string }): void {
    const id = this.id();
    if (this.agent === 'claude') {
      this.records.push({ type: 'assistant', uuid: `a-${id}`, session_id: 'e2e', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: this.shell === 'bash' ? 'Bash' : 'PowerShell', input: { command: cmd } }] } });
      const ok = ran.exit === 0;
      const content = ok ? ran.output : `Exit code ${ran.exit}\n${ran.output}`;
      this.records.push({ type: 'user', uuid: `u-${id}`, session_id: 'e2e', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: !ok }] }, tool_use_result: ok ? { stdout: ran.output, stderr: '', interrupted: false } : `Error: ${content}` });
      return;
    }
    const argv = this.shell === 'bash' ? ['bash', '-c', cmd] : ['pwsh', '-Command', cmd];
    const cwd = typeof dir === 'string' ? pathToFileURL(dir).href : dir.uri;
    this.records.push({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: id, input: '' } });
    this.records.push({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', id: `i-${id}`, command: argv, cwd, status: 'completed', exit_code: ran.exit, aggregated_output: ran.output } } });
    this.records.push({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id, output: '' } });
  }
  edit(file: string, before: string | null, after: string): void {
    const id = this.id();
    if (this.agent === 'claude') {
      const input = before === null ? { file_path: file, content: after } : { file_path: file, old_string: before, new_string: after, replace_all: false };
      this.records.push({ type: 'assistant', uuid: `a-${id}`, session_id: 'e2e', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: before === null ? 'Write' : 'Edit', input }] } });
      this.records.push({ type: 'user', uuid: `u-${id}`, session_id: 'e2e', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `The file ${file} has been updated successfully.` }] } });
      return;
    }
    this.records.push({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: id, input: '' } });
    this.records.push({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'FileChange', id: `i-${id}`, changes: { [file]: { type: before === null ? 'add' : 'update', unified_diff: '', move_path: null } }, status: 'completed' } } });
    this.records.push({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id, output: '' } });
  }
  /** A subagent: Claude's Task (it answers when done), Codex's spawn_agent (it answers that the agent is running). */
  subagent(): void {
    const id = this.id();
    if (this.agent === 'claude') {
      this.records.push({ type: 'assistant', uuid: `a-${id}`, session_id: 'e2e', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Task', input: { description: 'help', prompt: 'Tidy the code.', subagent_type: 'general-purpose' } }] } });
      this.records.push({ type: 'user', uuid: `u-${id}`, session_id: 'e2e', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Done.' }] } });
      return;
    }
    this.records.push({ type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: id, arguments: '{"task_name":"tidy","message":"Tidy the code."}' } });
    this.records.push({ type: 'response_item', payload: { type: 'function_call_output', call_id: id, output: '{"agent_id":"child","status":"running"}' } });
  }
  claim(): string {
    this.records.push(
      this.agent === 'claude'
        ? { type: 'assistant', uuid: 'claim', session_id: 'e2e', message: { id: 'm-claim', role: 'assistant', content: [{ type: 'text', text: 'All tests pass.' }], stop_reason: 'end_turn' } }
        : { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', id: 'msg', content: [{ type: 'Text', text: 'All tests pass.' }], phase: 'final_answer' } } },
    );
    return this.dump();
  }
  /** A hook the harness ran, as Claude Code's stream-json records it with --include-hook-events (Codex records none). */
  hook(event: string): void {
    const id = this.id();
    this.records.push({ type: 'system', subtype: 'hook_started', hook_event: event, uuid: `h-${id}`, session_id: 'e2e' });
    this.records.push({ type: 'system', subtype: 'hook_response', hook_event: event, exit_code: 0, outcome: 'success', uuid: `hr-${id}`, session_id: 'e2e' });
  }
  dump(): string {
    return this.records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  }
}

// ---------------------------------------------------------------------------
// One session.

interface Outcome {
  steps: string[];
  truth: boolean;
  severity: string;
  reason: string;
  violations: string[];
  categories: Set<string>;
}

const quote = (shell: Shell, p: string): string => (shell === 'bash' ? `'${p.replace(/'/g, `'\\''`)}'` : `'${p.replace(/'/g, "''")}'`);

async function session(seed: number, toyKey: 'ts' | 'py', agent: Agent, shell: Shell, work: string): Promise<Outcome> {
  const next = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  const toy = TOYS[toyKey];
  const dir = mkdtempSync(join(work, 's-'));
  try {
    // R (sometimes under a directory with an odd name), another checkout, both real git repositories.
    const parent = next() < 0.3 ? join(dir, 'my work [1]') : dir;
    mkdirSync(parent, { recursive: true });
    const R0 = join(parent, 'repo');
    const O0 = join(dir, 'other');
    makeRepo(R0, toy, next() < 0.25);
    makeRepo(O0, toy, next() < 0.5);
    const R = realpathSync.native(repoRoot(R0));
    const O = realpathSync.native(O0);
    const base = git(R, 'rev-parse', 'HEAD').trim();
    const log = join(dir, 'runs.jsonl');
    writeFileSync(log, '');
    // The agent's environment is a category of its own, the same wherever the test runs: none, an agent
    // vitest detects (CLAUDECODE, AI_AGENT: its `agent` reporter, no colours), forced colours, a CI.
    const envMode = pick(toy.envModes);
    const env = { ...AGENT_ENV_BASE, ...ENV_MODES[envMode], SDD_E2E_LOG: log, SDD_WORK: dir, npm_config_offline: 'true', npm_config_update_notifier: 'false' };

    // Hooks, a category of their own: none; a PostToolUse hook that really runs the suite after every edit; or a
    // Stop hook after the claim. Claude Code's stream records them only with --include-hook-events (drawn here),
    // Codex never.
    const hooksMode = pick(['none', 'post-edit', 'stop', 'stop'] as const);
    const recordHooks = agent === 'claude' && next() < 0.7;
    const t = new Transcript(agent, shell, R);
    const steps: string[] = [];
    const categories = new Set<string>([`env:${envMode}`, `hooks:${hooksMode}${recordHooks ? '+recorded' : ''}`]);
    let cwd = R;
    /** Hidden work a running subagent does later, out of sight: [the step it happens at, what it does]. */
    const hidden: [number, () => void][] = [];
    /** Markers the processes sent to the background write when they end. */
    const backgroundDone: string[] = [];

    const editFile = (path: string, f: (s: string) => string | null, visible: boolean): boolean => {
      const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
      const after = f(before ?? '');
      if (after === null || after === before) return false;
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, after);
      const rel = relative(R, path).split(/[\\/]/).join('/');
      if (visible) {
        t.edit(path, before === null ? null : before, after);
        if (hooksMode === 'post-edit') {
          // The hook runs the suite for real, recorded or not.
          runShell(shell, toy.run, R, false, env);
          if (recordHooks) t.hook('PostToolUse');
        }
      }
      return true;
    };
    const breakSrc = (root: string) => (): boolean => editFile(join(root, toy.src), (s) => (s.includes(toy.good) ? s.replace(toy.good, toy.bad) : null), false);
    const fixSrc = (root: string) => (): boolean => editFile(join(root, toy.src), (s) => (s.includes(toy.bad) ? s.replace(toy.bad, toy.good) : null), false);
    const tamper = ([, find, replace]: [string, string, string], visible: boolean) => (): boolean =>
      editFile(join(R, toy.testFile), (s) => (s.includes(find) ? s.replace(find, replace) : null), visible);

    /** Runs a command for real, writes it into the transcript and the steps, and follows Claude Code's shell. */
    const exec = (cmd: string, callDir: string | { uri: string }, at: string): void => {
      const ran = runShell(shell, cmd, at, agent === 'claude' && typeof callDir === 'string', env);
      t.command(cmd, ran, callDir);
      const where = typeof callDir === 'string' ? relative(dir, at) || '.' : `remote ${at}`;
      steps.push(`[${where}] ${cmd} → ${ran.exit}${agent === 'claude' && ran.cwd !== cwd ? ` (now in ${relative(dir, ran.cwd) || '.'})` : ''}${SESSION_LOG && ran.exit ? `\n      | ${ran.output.trim().split(/\r?\n/).slice(-4).join('\n      | ')}` : ''}`);
      if (agent === 'claude' && typeof callDir === 'string') cwd = ran.cwd;
    };
    const original = readFileSync(join(ROOT, 'bench', 'toy', toy.dir, toy.src), 'utf8');
    /** A full run of R's suite in the closed grammar, from R: the shape of a backed claim. */
    const fullRun = (): void => {
      const runCmd = pick(toy.fullRuns[shell]);
      if (agent === 'codex') exec(runCmd, R, R);
      else exec(cwd === R ? runCmd : `cd ${quote(shell, R)} && ${runCmd}`, cwd, cwd);
    };
    const visibleEditStep = (name: string, act: () => boolean): void => {
      steps.push(`edit ${name}${act() ? '' : ' (no change)'}`);
    };
    const restore = (): void => {
      visibleEditStep('restore src', () => editFile(join(R, toy.src), () => original, true));
      if (existsSync(join(R, toy.extra))) visibleEditStep('extra pass', () => editFile(join(R, toy.extra), () => toy.extraPass, true));
    };

    // The session's shape: free; the shape of a backed claim (a full green run in R after the last edit);
    // or near it with the suite really failing.
    // And the shapes of the rigid FAILs: nothing ran (`quiet`), an edit after which nothing ran
    // (`edit-quiet`), and a last command that is exactly a runner at the root (`rigid`, failing for real or
    // not, with a test that prints a forged summary or not).
    const shape = pick(['pass', 'pass', 'pass', 'near', 'near', 'near', 'free', 'free', 'quiet', 'edit-quiet', 'rigid', 'rigid'] as const);
    categories.add(`shape:${shape}`);
    const length = 3 + Math.floor(next() * 6);
    const prefix = shape === 'free' ? length : shape === 'quiet' ? 0 : Math.max(1, length - 2);
    const lastIsRun = next() < 0.5;
    for (let i = 0; i < prefix; i++) {
      for (const [at, act] of hidden) if (at === i) act();
      // A subagent makes the transcript opaque: never in the shape of a backed claim. The rigid shape: nothing may
      // move the shell (no cd, no subdirectory, no other directory) and nothing opaque.
      const moves = ['subdir', 'cd', ...(agent === 'codex' ? ['remote', 'workdir'] : [])];
      const categories0 = [
        'run', 'run', 'env', 'edit', 'edit', 'git', 'read', 'missing', 'write',
        ...(shape === 'rigid' ? ['run', 'edit'] : moves),
        ...(shape === 'pass' || shape === 'rigid' ? [] : ['agent']),
        ...(agent === 'codex' ? [] : ['run']),
        // A process sent to the background that runs the suite after the call returns (bash: `&`).
        ...(shell === 'bash' ? ['background'] : []),
      ];
      const allowed = (c: string): string => (WITHOUT.has(c) ? 'run' : c);
      // Half the free sessions end with a run: a plain one, one with a variable, or one in a subdirectory.
      const which = allowed(shape === 'free' && i === length - 1 && lastIsRun ? pick(['run', 'env', 'subdir']) : pick(categories0));
      categories.add(which);
      const runs = [...toy.runs.both, ...toy.runs[shell]];
      let cmd: string | null = null;
      let callDir: string | { uri: string } = cwd;
      if (which === 'run') cmd = pick(runs);
      else if (which === 'env') cmd = pick(runs.filter((r) => /^[A-Z_]+=|^\$env:/.test(r)));
      else if (which === 'subdir') {
        // The nested project sub1, and `sub[1]`: a wildcard for PowerShell's Set-Location.
        cmd = pick(
          shell === 'bash'
            ? [`cd sub1 && ${toy.run}`, `cd 'sub[1]' && ${toy.run}`, "cd 'sub[1]'", 'cd sub1']
            : [`cd 'sub[1]' && ${toy.run}`, `cd sub1; ${toy.run}`, "cd 'sub[1]'", "Set-Location 'sub[1]'", `Set-Location sub1; ${toy.run}`],
        );
      } else if (which === 'cd') {
        const cds =
          shell === 'bash'
            ? [`cd ../other && ${toy.run}`, 'cd ../other', `cd ${quote(shell, R)}`, `cd sub1 && ${toy.run}`, `cd 'sub[1]' && ${toy.run}`, 'cd src', 'cd ..', ...(toyKey === 'ts' ? ['npm test --prefix ../other'] : [])]
            : [`cd ../other; ${toy.run}`, 'Set-Location ../other', `Set-Location -LiteralPath ${quote(shell, R)}`, `cd ${quote(shell, R)}`, `cd sub1; ${toy.run}`, `cd 'sub[1]' && ${toy.run}`, "cd 'sub[1]'", 'cd src', 'cd ..'];
        cmd = pick(cds);
        // `../other` is the other checkout from R, wherever R is.
        if (cmd.includes('../other') && parent !== dir) cmd = cmd.replace('../other', quote(shell, O));
      } else if (which === 'git') cmd = pick(['git stash', 'git stash pop', 'git checkout -- .', 'git status --short', 'git diff --stat']);
      else if (which === 'read') cmd = pick(shell === 'bash' ? ['cat old.log', 'tail -3 old.log', 'ls'] : ['Get-Content old.log', 'Get-ChildItem']);
      else if (which === 'missing') cmd = pick(toy.missing);
      else if (which === 'background') {
        // Returns at once; the suite runs a second later, while the session goes on (its runs logged apart).
        const bgLog = join(dir, 'background-runs.jsonl').replace(/\\/g, '/');
        const done = join(dir, `background-${i}.done`).replace(/\\/g, '/');
        cmd = `(sleep 1; SDD_E2E_LOG='${bgLog}' ${toy.run} > background.log 2>&1; touch '${done}') > /dev/null 2>&1 &`;
        backgroundDone.push(done);
      }
      else if (which === 'write') cmd = pick(toy.writes[shell]);
      else if (which === 'workdir') {
        // Codex runs each command in the directory it chooses, and records it.
        callDir = pick([join(R, 'src'), join(R, 'sub1'), O]);
        cmd = pick(runs);
      } else if (which === 'remote') {
        // A call Codex records on another host: it ran there (here: in the other checkout).
        exec(toy.run, { uri: `file://devbox${pathToFileURL(O).pathname}` }, O);
      } else if (which === 'agent') {
        t.subagent();
        const act = pick([breakSrc(R), fixSrc(R), () => editFile(join(R, toy.extra), () => toy.extraFail, false), tamper(pick(toy.tamper), false)]);
        // Claude's Task answers when the subagent is done; Codex's spawn_agent while it still runs.
        if (agent === 'claude') act();
        else hidden.push([i + 1 + Math.floor(next() * (length - i)), act]);
        steps.push(`subagent (${agent === 'claude' ? 'done' : 'running'})`);
      } else {
        const edits: [string, () => boolean][] = [
          ['break', () => editFile(join(R, toy.src), (s) => (s.includes(toy.good) ? s.replace(toy.good, toy.bad) : null), true)],
          ['fix', () => editFile(join(R, toy.src), (s) => (s.includes(toy.bad) ? s.replace(toy.bad, toy.good) : null), true)],
          ['comment', () => editFile(join(R, toy.src), (s) => `${toyKey === 'ts' ? '//' : '#'} note ${i}\n${s}`, true)],
          ['doc', () => editFile(join(R, 'README.md'), (s) => `${s}\nMore notes ${i}.\n`, true)],
          ['extra pass', () => editFile(join(R, toy.extra), () => toy.extraPass, true)],
          ['extra fail', () => editFile(join(R, toy.extra), () => toy.extraFail, true)],
          ...toy.tamper.map((x): [string, () => boolean] => [`tamper ${x[0]}`, tamper(x, true)]),
          ['other', () => editFile(join(O, toy.src), (s) => (s.includes(toy.good) ? s.replace(toy.good, toy.bad) : s.replace(toy.bad, toy.good)), true)],
        ];
        const [name, act] = pick(edits);
        steps.push(`edit ${name}${act() ? '' : ' (no change)'}`);
      }
      if (cmd !== null) exec(cmd, callDir, typeof callDir === 'string' ? callDir : R);
    }

    if (shape === 'pass') {
      // The shape of a backed claim: R's code as it was (the agent's own edits), then a full green run, then nothing.
      restore();
      fullRun();
    } else if (shape === 'near') {
      // Near that shape, with the suite really failing at the claim.
      const variant = pick(['partial', 'old log', 'subdir', 'other', 'stale edit', 'stale shell', 'failing run', ...(agent === 'codex' ? ['remote'] : [])] as const);
      categories.add(`near:${variant}`);
      const broken = (): void => {
        restore();
        visibleEditStep('break', () => editFile(join(R, toy.src), (s) => s.replace(toy.good, toy.bad), true));
      };
      // The other checkout green: the world, not the agent.
      const otherGreen = (): void => {
        editFile(join(O, toy.src), () => original, false);
        if (existsSync(join(O, toy.extra))) editFile(join(O, toy.extra), () => toy.extraPass, false);
      };
      const inR = (c: string): void => exec(agent === 'claude' && cwd !== R ? `cd ${quote(shell, R)} && ${c}` : c, agent === 'claude' ? cwd : R, agent === 'claude' ? cwd : R);
      if (variant === 'partial') {
        // A green selection that leaves the broken tests out.
        broken();
        inR(pick(toy.partialRuns[shell]));
      } else if (variant === 'old log') {
        broken();
        inR(shell === 'bash' ? `${toy.run} 2>&1 | tail -5 old.log` : `${toy.run} *> out.log; Get-Content old.log -Tail 5`);
      } else if (variant === 'subdir') {
        broken();
        inR(shell === 'bash' ? `cd sub1 && ${toy.run}` : pick([`cd 'sub[1]' && ${toy.run}`, `cd sub1; ${toy.run}`]));
      } else if (variant === 'other') {
        broken();
        otherGreen();
        if (agent === 'codex') exec(toy.run, O, O);
        else exec(`cd ${quote(shell, O)} && ${toy.run}`, cwd, cwd);
      } else if (variant === 'remote') {
        broken();
        otherGreen();
        exec(toy.run, { uri: `file://devbox${pathToFileURL(O).pathname}` }, O);
      } else if (variant === 'stale edit') {
        restore();
        fullRun();
        visibleEditStep('break', () => editFile(join(R, toy.src), (s) => s.replace(toy.good, toy.bad), true));
      } else if (variant === 'stale shell') {
        restore();
        fullRun();
        inR(toy.writes[shell][1]!);
      } else {
        // A full run that fails: its summary as the environment prints it (coloured, the agent reporter…).
        broken();
        fullRun();
      }
    } else if (shape === 'quiet' || shape === 'edit-quiet') {
      // Edits, and nothing runs after them (`quiet`: nothing runs in the whole session).
      const edits: [string, () => boolean][] = [
        ['break', () => editFile(join(R, toy.src), (s) => (s.includes(toy.good) ? s.replace(toy.good, toy.bad) : null), true)],
        ['fix', () => editFile(join(R, toy.src), (s) => (s.includes(toy.bad) ? s.replace(toy.bad, toy.good) : null), true)],
        ['comment', () => editFile(join(R, toy.src), (s) => `${toyKey === 'ts' ? '//' : '#'} quiet note\n${s}`, true)],
        ['extra fail', () => editFile(join(R, toy.extra), () => toy.extraFail, true)],
        ...(shape === 'quiet' ? ([['doc', () => editFile(join(R, 'README.md'), (s) => `${s}\nQuiet notes.\n`, true)]] as [string, () => boolean][]) : []),
      ];
      for (let k = 1 + Math.floor(next() * 2); k > 0; k--) {
        const [name, act] = pick(edits);
        visibleEditStep(name, act);
      }
    } else if (shape === 'rigid') {
      // The rigid shape of a failure: the last command is exactly a runner, at the root, nothing ever moved the
      // shell. The suite fails for real or not; a test may print a forged summary, green or red.
      const forged = pick(['none', 'green', 'red'] as const);
      categories.add(`forged:${forged}`);
      if (forged !== 'none') visibleEditStep(`forged ${forged}`, () => editFile(join(R, toy.fakeTest), () => toy.forgedSummary(forged), true));
      if (next() < 0.7) visibleEditStep('break', () => editFile(join(R, toy.src), (s) => (s.includes(toy.good) ? s.replace(toy.good, toy.bad) : null), true));
      const runCmd = pick(toy.rigidRuns);
      exec(runCmd, agent === 'codex' ? R : cwd, agent === 'codex' ? R : cwd);
    }
    for (const [at, act] of hidden) if (at >= prefix) act();
    t.claim();
    // The Stop hook runs after the claim (recorded only by Claude Code's stream with --include-hook-events).
    if (hooksMode === 'stop' && recordHooks) t.hook('Stop');
    const text = t.dump();
    // The processes sent to the background end before the truth is taken (and before the directory goes).
    for (const done of backgroundDone) {
      const until = Date.now() + 120_000;
      while (!existsSync(done) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }

    // The truth.
    const { passed: truth, detail: truthDetail } = truthOf(toy, R, dir);

    git(R, 'add', '-A');
    git(R, 'commit', '-q', '--allow-empty', '-m', 'claim');
    const head = git(R, 'rev-parse', 'HEAD').trim();
    const report = await runCheck({ repo: R, base, head, transcript: { text, agent: 'auto', label: 'transcript.jsonl' } });
    const tg = report.findings.find((f) => f.rule === 'TG006');

    const violations: string[] = [];
    const severity = !tg ? 'none' : tg.severity;
    if (!tg) violations.push('no TG006 finding');
    for (const f of report.findings) {
      if ((f.rule === 'TG006' || f.rule === 'TG007') && f.severity === 'fail') violations.push(`${f.rule} FAIL (${f.reason ?? '-'}): a claim is at most a WARN`);
      if ((f.rule === 'TG006' || f.rule === 'TG007') && /\bbacked by\b|\bverified\b/i.test(f.message.replace(/not verified|unverified/gi, ''))) violations.push(`${f.rule} says a claim is verified`);
    }
    if (tg?.severity === 'info' && tg.reason !== 'consistent_unverified' && tg.reason !== 'disclosed') violations.push(`a TG006 INFO that is not consistent_unverified (${tg.reason})`);
    if ((report.verdict as string) === 'PASS') violations.push('a PASS');
    // A FAIL comes from a diff rule on its own: the same diff without the agent's side fails too.
    if (report.verdict === 'FAIL' && (await runCheck({ repo: R, base, head })).verdict !== 'FAIL') violations.push('a FAIL that needs the claim (an escalation)');
    return { steps: violations.length ? [...steps, truthDetail] : steps, truth, severity, reason: tg?.reason ?? '-', violations, categories };
  } finally {
    removeSession(dir);
  }
}

// ---------------------------------------------------------------------------

const work = realpathSync.native(mkdtempSync(join(tmpdir(), 'saidvsdid-e2e-')));
afterAll(() => rmSync(work, { recursive: true, force: true }));

// The red CI of the commit that added the end-to-end oracle against reality (seed 20261003, ts · claude · bash): every run green, TG006 PASS, and the old
// truth said the suite failed. It read the suite's output with /Tests\s+\d+ passed/ and ran it without
// NO_COLOR. Under GitHub Actions vitest colours its output (`CI` is set; on Windows always): an ANSI
// sequence sits between "Tests" and the count, so the regex read a failure where the runner recorded
// 5 passed, 0 failed. Run locally from an agent, vitest turns colours off (std-env's agent detection:
// CLAUDECODE, AI_AGENT…), which is why it never showed there. The oracle was wrong, not TG006 (its parser
// strips ANSI). The truth is now the runner's own record, whatever the environment.
describe.skipIf(!HAS_VITEST)('the truth is what the runner recorded, whatever colours its output', () => {
  it('seed 20261003: a coloured green summary is not a failure', () => {
    const dir = mkdtempSync(join(work, 'truth-'));
    try {
      makeRepo(join(dir, 'good'), TOYS.ts, false);
      makeRepo(join(dir, 'broken'), TOYS.ts, true);
      // The environment of the red job: a CI, no agent, no NO_COLOR.
      const ci = { ...Object.fromEntries(Object.entries(CLEAN_ENV).filter(([k]) => !AGENT_VARS.test(k) && k !== 'NO_COLOR')), CI: 'true', GITHUB_ACTIONS: 'true' };
      const r = spawnSync(process.execPath, [join(dir, 'good', 'node_modules', 'vitest', 'vitest.mjs'), 'run'], { cwd: join(dir, 'good'), env: ci, encoding: 'utf8', timeout: 180_000 });
      const out = `${r.stdout}${r.stderr}`;
      // The cause: green, yet the old method read a failure.
      expect(r.status).toBe(0);
      expect(out).toContain('\u001b[');
      expect(/Tests\s+\d+ passed/.test(out)).toBe(false);
      // The truth does not depend on the environment: a CI, forced colours, an agent.
      for (const env of [CLEAN_ENV, ci, { ...ci, FORCE_COLOR: '1' }, { ...ci, CLAUDECODE: '1' }]) {
        expect(truthOf(TOYS.ts, join(dir, 'good'), dir, env).passed).toBe(true);
        expect(truthOf(TOYS.ts, join(dir, 'broken'), dir, env).passed).toBe(false);
      }
    } finally {
      removeSession(dir);
    }
  }, 300_000);
});

const COMBOS = (['ts', 'py'] as const)
  .filter((t) => (t === 'ts' ? HAS_VITEST : HAS_PYTEST))
  .flatMap((toy) => (['claude', 'codex'] as const).flatMap((agent) => SHELLS.map((shell) => [toy, agent, shell] as const)));

describe.skipIf(!COMBOS.length)('end to end against reality: TG006 on sessions that really ran', () => {
  const totals = { sessions: 0, ms: 0, truthPass: 0, truthFail: 0, warn: 0, info: 0, reasons: {} as Record<string, number>, byShape: {} as Record<string, Record<string, number>> };
  afterAll(() => {
    if (SESSION_LOG) appendFileSync(SESSION_LOG, `e2e-real: ${totals.sessions} sessions in ${(totals.ms / 1000).toFixed(0)} s (seed ${SEED}): ${JSON.stringify(totals)}\n`);
  });

  it.each(COMBOS)('%s · %s · %s', async (toy, agent, shell) => {
    const bad: string[] = [];
    for (let k = 0; k < PER_COMBO; k++) {
      const seed = SEED + k * 7919 + COMBOS.findIndex(([t, a, s]) => t === toy && a === agent && s === shell) * 104729;
      const start = Date.now();
      const o = await session(seed, toy, agent, shell, work);
      totals.sessions++;
      totals.ms += Date.now() - start;
      totals[o.truth ? 'truthPass' : 'truthFail']++;
      if (o.severity === 'warn' || o.severity === 'info') totals[o.severity]++;
      totals.reasons[o.reason] = (totals.reasons[o.reason] ?? 0) + 1;
      const tags = [...o.categories].filter((c) => c.includes(':'));
      for (const tag of tags.filter((c) => /^(shape|env|hooks):/.test(c))) {
        const b = (totals.byShape[tag] ??= {});
        b[o.severity] = (b[o.severity] ?? 0) + 1;
      }
      if (SESSION_LOG) appendFileSync(SESSION_LOG, `${toy} ${agent} ${shell} seed ${seed} [${tags.join(' ')}]: truth ${o.truth ? 'passes' : 'fails'}, TG006 ${o.severity} ${o.reason}${o.violations.length ? ` VIOLATION ${o.violations.join('; ')}` : ''}\n    ${o.steps.join('\n    ')}\n`);
      if (o.violations.length) bad.push(`seed ${seed}: ${o.violations.join('; ')} (truth ${o.truth ? 'passes' : 'fails'}, TG006 ${o.severity})\n    ${o.steps.join('\n    ')}`);
    }
    expect(bad).toEqual([]);
  }, 1_800_000);
});
