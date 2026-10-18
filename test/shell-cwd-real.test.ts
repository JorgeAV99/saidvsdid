// Where a test run really ran, against a real bash: "the oracle is the real system".
//
// Sequences of calls are generated from a grammar much wider than the one
// saidvsdid places (subshells, `;`, `||`, pushd/popd, variables, conditional
// `cd`, `cd -`, pipelines, several runners, several calls in a row) and run, in
// order, in ONE bash process — the way Claude Code's Bash keeps its working
// directory between calls. The test runners are replaced by scripts that
// record the directory they ran in. For every run, saidvsdid must either leave
// it unplaced or name exactly that directory. Runs on Linux and macOS, and on
// Windows with Git Bash when `bash` is on the PATH.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { evidenceFromSession } from '../src/evidence/from-transcript.js';
import type { RepoModel } from '../src/location.js';
import { parseTranscript } from '../src/transcript/index.js';

const bash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
const hasBash = bash.status === 0 && bash.stdout.trim() === 'ok';

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
const pick = <T,>(next: () => number, xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;

const work = mkdtempSync(join(tmpdir(), 'saidvsdid-shell-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe.skipIf(!hasBash)('working directories against a real bash', () => {
  it('every run is unplaced or placed exactly where it ran', () => {
    // A repository, another checkout, and fake runners that record where they ran.
    const files = ['package.json', 'src/a.js', 'src/deep/b.js', 'packages/a/index.js', 'test/a.test.js'];
    for (const f of files) {
      mkdirSync(join(work, 'repo', f, '..'), { recursive: true });
      writeFileSync(join(work, 'repo', f), '{}\n');
    }
    mkdirSync(join(work, 'other', 'src'), { recursive: true });
    mkdirSync(join(work, 'bin'), { recursive: true });
    const runner = '#!/bin/sh\nprintf \'%s %s %s\\n\' "$SEQ" "$CALL" "$PWD" >> "$RUNLOG"\nprintf \' Test Files  1 passed (1)\\n      Tests  1 passed (1)\\n\'\n';
    for (const name of ['npm', 'npx', 'pytest', 'vitest']) {
      writeFileSync(join(work, 'bin', name), runner);
      chmodSync(join(work, 'bin', name), 0o755);
    }
    // The paths as bash spells them (`/c/Users/…` on Git Bash, `/var/…` on macOS).
    const root = spawnSync('bash', ['-c', 'cd "$1" && pwd', '_', work], { encoding: 'utf8' }).stdout.trim();
    const R = `${root}/repo`;
    const O = `${root}/other`;
    const model: RepoModel = { trees: [{ files: new Set(files), symlinks: new Set(), submodules: new Set() }] };

    const LITS = [R, `${R}/src`, `${R}/packages/a`, `${R}/src/deep`, O, `${O}/src`, 'src', 'deep', '..', 'packages/a', '../other', '../repo', 'nope', `'${R}/src'`, `"${O}"`];
    const RUNS = [
      'npm test',
      'npx vitest run',
      'pytest -q',
      'npm test 2>&1 | tail -5',
      'CI=1 npm test',
      'npx vitest run src/a.js',
      `npm test --prefix ${O}`,
      `pytest --rootdir=${O}`,
      'npm run test',
      'python3 -m pytest -x',
      // Quoted filters, read as bash reads them: escapes inside double quotes, `$` inside single quotes…
      'npx vitest run src/a.js 2>&1 | grep -E "Tests\\|passed" | head -30',
      'npm test 2>&1 | grep -E "^\\s+(x|y)|Tests \\"ok\\"" | head -5',
      "npm test 2>&1 | grep -E 'passed$|failed' | head -3",
      'npm test | grep "\\$HOME" | tail -2',
      "pytest -k 'a or b' 2>&1 | tail -3",
      // …and expansions inside double quotes, which stay outside.
      'npm test | grep "$HOME"',
      'npm test | grep "`pwd`"',
      'npm test | grep "$(pwd)"',
    ];
    const TEMPLATES = [
      'RUN',
      'RUN',
      'cd LIT && RUN',
      'cd LIT && RUN',
      'cd LIT && RUN',
      'cd LIT',
      'cd LIT',
      'cd LIT; RUN',
      '(cd LIT; RUN)',
      '(cd LIT); RUN',
      'cd LIT && (true; cd LIT2; true); RUN',
      'pushd LIT >/dev/null && RUN; popd >/dev/null',
      'pushd LIT >/dev/null; RUN',
      'popd >/dev/null; RUN',
      'D=LIT; cd $D && RUN',
      'cd LIT || cd LIT2; RUN',
      'false && cd LIT; RUN',
      'true && cd LIT && RUN',
      'cd LIT && RUN | tail -3',
      'cd LIT | cat; RUN',
      'cd - >/dev/null && RUN',
      'RUN; RUN',
      'if true; then cd LIT; fi; RUN',
      'cd LIT && cd LIT2 && RUN',
      'ls >/dev/null && RUN',
    ];
    // Coverage by construction, not by luck: sequences whose last run must be placed (in this directory) or
    // unplaced, whatever the random ones below happen to draw.
    const GUARANTEED: [string[], string | null][] = [
      [['npm test'], ''],
      [['npx vitest run'], ''],
      [['pytest -q'], ''],
      [['npm test 2>&1 | tail -5'], ''],
      [['cd src', 'npm test'], 'src'],
      [['cd src && npx vitest run'], 'src'],
      [[`cd "${R}/packages/a" && npm test`], 'packages/a'],
      [['cd src', 'cd deep', 'pytest -q'], 'src/deep'],
      [['cd src; npm test'], null],
      [['(cd src && npm test)'], null],
      [['cd "$HOME" && npm test'], null],
      [[`npm test --prefix ${O}`], null],
      [['ls >/dev/null && npm test'], null],
    ];
    const next = rng(20261003);
    const sequences: string[][] = GUARANTEED.map(([seq]) => seq);
    for (let s = 0; s < 250; s++) {
      const n = 1 + Math.floor(next() * 4);
      sequences.push(
        Array.from({ length: n }, () =>
          pick(next, TEMPLATES).replace('LIT2', pick(next, LITS)).replace('LIT', pick(next, LITS)).replace(/RUN/g, () => pick(next, RUNS)),
        ),
      );
    }
    // One bash for everything: each sequence starts at the repository with an empty directory stack.
    const script = sequences
      .map((calls, s) =>
        [`cd "${R}"; dirs -c; OLDPWD=; export SEQ=${s}`, ...calls.flatMap((c, i) => [`export CALL=${i}`, c, `echo "${s} ${i} $?" >> "$EXITLOG"`])].join('\n'),
      )
      .join('\n');
    writeFileSync(join(work, 'script.sh'), `${script}\n`);
    const runlog = join(work, 'runs.log');
    const exitlog = join(work, 'exits.log');
    writeFileSync(runlog, '');
    writeFileSync(exitlog, '');
    const sep = process.platform === 'win32' ? ';' : ':';
    const res = spawnSync('bash', ['--noprofile', '--norc', join(work, 'script.sh')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(work, 'bin')}${sep}${process.env.PATH}`, RUNLOG: runlog, EXITLOG: exitlog },
    });
    expect(res.error).toBeUndefined();
    const ran = new Map<string, string[]>();
    for (const line of readFileSync(runlog, 'utf8').split('\n').filter(Boolean)) {
      const [s, c, ...dir] = line.split(' ');
      const key = `${s} ${c}`;
      ran.set(key, [...(ran.get(key) ?? []), dir.join(' ')]);
    }
    const exits = new Map(readFileSync(exitlog, 'utf8').split('\n').filter(Boolean).map((l) => [l.split(' ').slice(0, 2).join(' '), Number(l.split(' ')[2])] as const));

    const broken: string[] = [];
    const seen = { placed: 0, unplaced: 0, notRun: 0 };
    /** For the last run of each sequence: where saidvsdid placed it (null: unplaced) and where it really ran. */
    const last = new Map<number, { placed: string | null; ran: string | undefined }>();
    sequences.forEach((calls, s) => {
      // A Claude Code stream-json transcript of the sequence, one prefix at a time: the runs each call adds.
      const records: object[] = [{ type: 'system', subtype: 'init', cwd: R, session_id: `s${s}`, tools: ['Bash'], model: 'synthetic' }];
      let before = 0;
      calls.forEach((command, i) => {
        const id = `toolu_${s}_${i}`;
        const key = `${s} ${i}`;
        const exit = exits.get(key) ?? 0;
        const out = (ran.get(key) ?? []).map(() => ' Test Files  1 passed (1)\n      Tests  1 passed (1)\n').join('');
        records.push({ type: 'assistant', message: { id: `m${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
        records.push({
          type: 'user',
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: exit === 0 ? out : `Exit code ${exit}\n${out}`, is_error: exit !== 0 }] },
          tool_use_result: { stdout: out, stderr: '', interrupted: false, isImage: false },
        });
        const text = [...records, { type: 'assistant', message: { id: 'end', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } }].map((r) => JSON.stringify(r)).join('\n');
        const ev = evidenceFromSession(parseTranscript(text, 'claude'), { roots: [R], model });
        const runs = ev.runs.slice(before);
        before = ev.runs.length;
        const real = ran.get(key) ?? [];
        runs.forEach((run, j) => {
          const placed = run.cwd !== null && !run.cwd.startsWith('/') && !/^[A-Za-z]:/.test(run.cwd);
          if (i === calls.length - 1) last.set(s, { placed: placed ? run.cwd : null, ran: real[j] });
          if (!placed) {
            seen.unplaced++;
            return;
          }
          // The runner did not run (a `cd` before it failed): nothing to compare.
          if (real[j] === undefined) {
            seen.notRun++;
            return;
          }
          seen.placed++;
          const want = run.cwd ? `${R}/${run.cwd}` : R;
          if (real[j] !== want) broken.push(`sequence ${s}, call ${i} \`${command}\` (after ${JSON.stringify(calls.slice(0, i))}): placed in ${want}, ran in ${real[j]}`);
        });
      });
    });
    expect(broken.slice(0, 10)).toEqual([]);
    // Not trivially unplaced, by construction: every guaranteed sequence ends as it must.
    const got = GUARANTEED.map(([seq, dir], s) => {
      const o = last.get(s);
      return [seq.join(' ; '), o === undefined ? 'no run' : o.placed === null ? 'unplaced' : `placed in ${o.placed || '.'}, ran in ${o.ran === undefined ? 'nothing' : o.ran === (o.placed ? `${R}/${o.placed}` : R) ? 'it' : o.ran}`];
    });
    expect(got).toEqual(GUARANTEED.map(([seq, dir]) => [seq.join(' ; '), dir === null ? 'unplaced' : `placed in ${dir || '.'}, ran in it`]));
  }, 300_000);
});

// ---------------------------------------------------------------------------
// PowerShell: the same oracle with a real `pwsh` (PowerShell 7: Linux, macOS,
// Windows) and, on Windows, Windows PowerShell 5.1 — the shells Codex and
// Claude Code's PowerShell tool use. Calls run in ONE PowerShell process,
// each through Invoke-Expression read from a JSON file (no quoting between
// the test and the shell; a parse error, such as `&&` in 5.1, stops only its
// call). The runners are scripts that record the location they ran in.

const POWERSHELLS = ['pwsh', ...(process.platform === 'win32' ? ['powershell'] : [])].filter(
  (exe) => spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output ok'], { encoding: 'utf8' }).stdout?.trim() === 'ok',
);

const DRIVER = String.raw`
$ErrorActionPreference = 'Continue'
$calls = Get-Content -Raw -Encoding UTF8 -LiteralPath $env:CALLS | ConvertFrom-Json
$seq = -1
foreach ($c in $calls) {
  if ($c.s -ne $seq) {
    $seq = $c.s
    while ((Get-Location -Stack).Count -gt 0) { Pop-Location }
    Set-Location -LiteralPath $env:REPO
    Remove-Variable -Name D -ErrorAction SilentlyContinue
  }
  $env:SEQ = $c.s
  $env:CALL = $c.i
  $Error.Clear()
  try { Invoke-Expression $c.cmd *>&1 | Out-Null } catch { }
  $code = if ($Error.Count -gt 0) { 1 } else { 0 }
  Add-Content -LiteralPath $env:EXITLOG -Value "$($c.s) $($c.i) $code"
}
`;
const RUNNER_PS1 = String.raw`Add-Content -LiteralPath $env:RUNLOG -Value "$env:SEQ $env:CALL $((Get-Location).ProviderPath)"
Write-Output ' Test Files  1 passed (1)'
Write-Output '      Tests  1 passed (1)'
`;

describe.each(POWERSHELLS)('working directories against a real %s', (exe) => {
  it('every run is unplaced or placed exactly where it ran', () => {
    const home = mkdtempSync(join(tmpdir(), `saidvsdid-${exe}-`));
    try {
      const files = ['package.json', 'src/a.js', 'src/deep/b.js', 'packages/a/index.js', 'test/a.test.js'];
      for (const f of files) {
        mkdirSync(join(home, 'repo', f, '..'), { recursive: true });
        writeFileSync(join(home, 'repo', f), '{}\n');
      }
      mkdirSync(join(home, 'other', 'src'), { recursive: true });
      mkdirSync(join(home, 'bin'), { recursive: true });
      for (const name of ['npm', 'npx', 'pytest', 'python3']) writeFileSync(join(home, 'bin', `${name}.ps1`), RUNNER_PS1);
      // Codex on Windows runs `npm.cmd`: a batch file sees the location as its working directory.
      if (process.platform === 'win32') writeFileSync(join(home, 'bin', 'npm.cmd'), '@echo %SEQ% %CALL% %CD%>>"%RUNLOG%"\r\n@echo  Tests  1 passed (1)\r\n');
      writeFileSync(join(home, 'driver.ps1'), DRIVER);
      const run = (args: string[], env: Record<string, string> = {}) =>
        spawnSync(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], {
          encoding: 'utf8',
          env: { ...process.env, PATH: `${join(home, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`, ...env },
        });
      // The repository as PowerShell spells its location.
      const R = run(['-Command', `Set-Location -LiteralPath '${join(home, 'repo')}'; (Get-Location).ProviderPath`]).stdout.trim();
      const O = run(['-Command', `Set-Location -LiteralPath '${join(home, 'other')}'; (Get-Location).ProviderPath`]).stdout.trim();
      const sep = process.platform === 'win32' ? '\\' : '/';
      const model: RepoModel = { trees: [{ files: new Set(files), symlinks: new Set(), submodules: new Set() }] };

      const LITS = [
        R,
        `${R}${sep}src`,
        `${R}${sep}packages${sep}a`,
        O,
        `${O}${sep}src`,
        'src',
        'deep',
        '..',
        `..${sep}other`,
        'packages/a',
        'nope',
        `'${R}${sep}src'`,
        `"${O}"`,
        "'src'",
        '"src"',
        // backquote escapes inside double quotes: `r is a carriage return, `` a backquote, `$ a dollar
        '"s`rc"',
        '"s``rc"',
        '"`$x"',
        // location history, case, typographic quotes
        '+',
        '-',
        'SRC',
        '‘src’',
        '“src”',
      ];
      const RUNS = [
        'npm test',
        'npx vitest run',
        'pytest -q',
        'npm test 2>&1',
        'npx vitest run src/a.js',
        `npm test --prefix ${O}`,
        'npm run test',
        'python3 -m pytest -x',
        'npm test @args',
        'npx vitest run src/a.js,test/a.test.js',
        'npm test | Select-Object -Last 2',
        // every other form the grammar accepts, as PowerShell reads it
        'CI=1 npm test',
        'npm test 2>&1 | tail -3',
        'npx vitest run src/a.js 2>&1 | grep -E "passed|failed" | head -5',
        'npm test | tee out.log',
        "pytest -k 'a or b' -q",
        'npx vitest run -t "a`$b"',
        ...(process.platform === 'win32' ? ['npm.cmd test', 'npm.cmd test 2>&1'] : []),
      ];
      const TEMPLATES = [
        'RUN',
        'RUN',
        'cd LIT && RUN',
        'cd LIT && RUN',
        'Set-Location LIT; RUN',
        'cd LIT',
        'cd LIT',
        'Set-Location LIT',
        'Set-Location -Path LIT',
        'Push-Location LIT; RUN; Pop-Location',
        'Push-Location LIT',
        'Pop-Location; RUN',
        'cd LIT || cd LIT2; RUN',
        '$D = "LIT"; cd $D; RUN',
        'cd "$D"; RUN',
        'cd "$(Get-Location)"; RUN',
        '& { cd LIT; RUN }',
        '& { cd LIT }; RUN',
        '. { cd LIT }; RUN',
        'cd LIT; if ($?) { RUN }',
        'RUN; RUN',
        'cd LIT && cd LIT2 && RUN',
        '$env:CI = 1; RUN',
      ];
      // Coverage by construction, not by luck (and without `&&`, which Windows PowerShell 5.1 lacks): sequences whose
      // last run must be placed (in this directory) or unplaced, whatever the random ones below draw.
      const GUARANTEED: [string[], string | null][] = [
        [['npm test'], ''],
        [['npx vitest run'], ''],
        [['pytest -q'], ''],
        [['npm test 2>&1'], ''],
        [['cd src', 'npm test'], 'src'],
        [['Set-Location src', 'pytest -q'], 'src'],
        [[`cd '${R}${sep}packages${sep}a'`, 'npx vitest run'], 'packages/a'],
        [['cd src', 'cd deep', 'npm test'], 'src/deep'],
        [['cd src; npm test'], null],
        [['$D = "src"; cd $D; npm test'], null],
        [['& { cd src; npm test }'], null],
        [[`npm test --prefix ${O}`], null],
      ];
      const next = rng(20261005);
      const calls: { s: number; i: number; cmd: string }[] = [];
      const sequences: string[][] = [];
      GUARANTEED.forEach(([seq], s) => {
        sequences.push(seq);
        seq.forEach((cmd, i) => calls.push({ s, i, cmd }));
      });
      for (let s = GUARANTEED.length; s < GUARANTEED.length + 250; s++) {
        const n = 1 + Math.floor(next() * 4);
        const seq = Array.from({ length: n }, () =>
          pick(next, TEMPLATES)
            .replace('LIT2', pick(next, LITS))
            .replace('LIT', pick(next, LITS))
            .replace(/RUN/g, () => pick(next, RUNS)),
        );
        sequences.push(seq);
        seq.forEach((cmd, i) => calls.push({ s, i, cmd }));
      }
      writeFileSync(join(home, 'calls.json'), JSON.stringify(calls));
      const runlog = join(home, 'runs.log');
      const exitlog = join(home, 'exits.log');
      writeFileSync(runlog, '');
      writeFileSync(exitlog, '');
      const res = run(['-File', join(home, 'driver.ps1')], { CALLS: join(home, 'calls.json'), REPO: R, RUNLOG: runlog, EXITLOG: exitlog });
      expect(res.error).toBeUndefined();
      const ran = new Map<string, string[]>();
      for (const line of readFileSync(runlog, 'utf8').split(/\r?\n/).filter(Boolean)) {
        const [s, c, ...dir] = line.trim().split(' ');
        const key = `${s} ${c}`;
        ran.set(key, [...(ran.get(key) ?? []), dir.join(' ')]);
      }
      const exits = new Map(
        readFileSync(exitlog, 'utf8')
          .split(/\r?\n/)
          .filter(Boolean)
          .map((l) => [l.split(' ').slice(0, 2).join(' '), Number(l.split(' ')[2])] as const),
      );
      expect(exits.size).toBe(calls.length);

      const broken: string[] = [];
      const seen = { placed: 0, unplaced: 0, notRun: 0 };
      /** For the last run of each sequence: where saidvsdid placed it (null: unplaced) and where it really ran. */
      const last = new Map<number, { placed: string | null; ran: string | undefined }>();
      sequences.forEach((seq, s) => {
        // Claude Code's PowerShell tool, which keeps its location between calls.
        const records: object[] = [{ type: 'system', subtype: 'init', cwd: R, session_id: `p${s}`, tools: ['PowerShell'], model: 'synthetic' }];
        let before = 0;
        seq.forEach((command, i) => {
          const id = `toolu_${s}_${i}`;
          const key = `${s} ${i}`;
          const exit = exits.get(key) ?? 0;
          const out = (ran.get(key) ?? []).map(() => ' Test Files  1 passed (1)\n      Tests  1 passed (1)\n').join('');
          records.push({ type: 'assistant', message: { id: `m${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'PowerShell', input: { command } }] } });
          records.push({
            type: 'user',
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: exit === 0 ? out : `Exit code ${exit}\n${out}`, is_error: exit !== 0 }] },
            tool_use_result: { stdout: out, stderr: '', interrupted: false, isImage: false },
          });
          const text = [...records, { type: 'assistant', message: { id: 'end', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } }]
            .map((r) => JSON.stringify(r))
            .join('\n');
          const ev = evidenceFromSession(parseTranscript(text, 'claude'), { roots: [R], model });
          const runs = ev.runs.slice(before);
          before = ev.runs.length;
          const real = ran.get(key) ?? [];
          runs.forEach((r, j) => {
            const placed = r.cwd !== null && !r.cwd.startsWith('/') && !/^[A-Za-z]:/.test(r.cwd);
            if (i === seq.length - 1) last.set(s, { placed: placed ? r.cwd : null, ran: real[j] });
            if (!placed) {
              seen.unplaced++;
              return;
            }
            if (real[j] === undefined) {
              seen.notRun++;
              return;
            }
            seen.placed++;
            const want = r.cwd ? `${R}${sep}${r.cwd.split('/').join(sep)}` : R;
            if (real[j] !== want) broken.push(`${exe}: sequence ${s}, call ${i} \`${command}\` (after ${JSON.stringify(seq.slice(0, i))}): placed in ${want}, ran in ${real[j]}`);
          });
        });
      });
      expect(broken.slice(0, 10)).toEqual([]);
      // Not trivially unplaced, by construction: every guaranteed sequence ends as it must.
      const where = (dir: string): string => (dir ? `${R}${sep}${dir.split('/').join(sep)}` : R);
      const got = GUARANTEED.map(([seq], s) => {
        const o = last.get(s);
        return [seq.join(' ; '), o === undefined ? 'no run' : o.placed === null ? 'unplaced' : `placed in ${o.placed || '.'}, ran in ${o.ran === where(o.placed) ? 'it' : (o.ran ?? 'nothing')}`];
      });
      expect(got).toEqual(GUARANTEED.map(([seq, dir]) => [seq.join(' ; '), dir === null ? 'unplaced' : `placed in ${dir || '.'}, ran in it`]));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 300_000);
});
