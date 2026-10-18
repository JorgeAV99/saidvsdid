// scripts/record-session.mjs: the sanitiser and the temporary repository
// lifecycle. The agents themselves are not run here.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitHead, prepareRepo, removeWork, sanitizer, writeSession } from '../scripts/record-session.mjs';

const ROOT = join(import.meta.dirname, '..');

describe('record-session sanitiser', () => {
  const win = sanitizer({
    repo: String.raw`C:\Users\alice\AppData\Local\Temp\sdd-rec-x\repo`,
    work: String.raw`C:\Users\alice\AppData\Local\Temp\sdd-rec-x`,
    home: String.raw`C:\Users\alice`,
    user: 'alice',
    host: 'ALICE-DESKTOP',
    gitName: 'Alice Liddell',
    gitEmail: 'alice@wonder.example',
    env: { GH_TOKEN: 'not-a-real-token-1234', PATH: String.raw`C:\Windows` },
  });

  it('replaces every spelling of the paths, the identity and secrets', () => {
    const raw = [
      // JSON-escaped backslashes, and a lower-cased drive path
      String.raw`{"cwd":"C:\\Users\\alice\\AppData\\Local\\Temp\\sdd-rec-x\\repo","file":"c:\\users\\alice\\.claude\\x"}`,
      // Git Bash and forward-slash spellings
      'cd /c/Users/alice/AppData/Local/Temp/sdd-rec-x/repo/src && ls C:/Users/alice/Desktop',
      // plain backslashes, and Claude Code's encoded project directory
      String.raw`C:\Users\alice\.claude\projects\C--Users-alice-AppData-Local-Temp-sdd-rec-x-repo\id.jsonl`,
      'Author: Alice Liddell <alice@wonder.example>, cc bob@corp.example.com, host ALICE-DESKTOP, user alice',
      // Token-shaped only at run time: no versioned file holds one (test/privacy.test.ts).
      'GH_TOKEN=not-a-real-token-1234 key ' + 'sk-ant-' + 'api03-abcdefghijklmnop ' + 'ghp_' + 'abcdefghijklmnopqrstuvwxyz',
    ].join('\n');
    const clean = win.sanitize(raw);
    expect(clean).toBe(
      [
        String.raw`{"cwd":"<REPO>","file":"<HOME>\\.claude\\x"}`,
        'cd <REPO>/src && ls <HOME>/Desktop',
        String.raw`<HOME>\.claude\projects\<REPO>\id.jsonl`,
        'Author: <USER> <<EMAIL>>, cc <EMAIL>, host <HOST>, user <USER>',
        'GH_TOKEN=<ENV:GH_TOKEN> key <TOKEN> <TOKEN>',
      ].join('\n'),
    );
    expect(win.leaks(clean)).toEqual([]);
  });

  it('does not take Python decorators for email addresses', () => {
    // In a diff (`+@…`) and after a JSON-escaped newline (`\n@…`): the codex-regression recording lost one.
    const text = String.raw`+@pytest.mark.parametrize( {"out":"x\n@pytest.mark.skip\n"} @app.route("/") a.b@example.com`;
    expect(win.sanitize(text)).toBe(String.raw`+@pytest.mark.parametrize( {"out":"x\n@pytest.mark.skip\n"} @app.route("/") <EMAIL>`);
  });

  it('redacts account and organisation ids in JSON', () => {
    const line = '{"type":"credential_org","organizationUuid":"94a8-x","account_id":"a1","sessionId":"s"}';
    const clean = win.sanitize(line);
    expect(clean).toBe('{"type":"credential_org","organizationUuid":"<REDACTED>","account_id":"<REDACTED>","sessionId":"s"}');
    expect(win.leaks(clean)).toEqual([]);
    expect(win.leaks(line)).toContain('account id');
  });

  it('handles POSIX paths', () => {
    const posix = sanitizer({ repo: '/tmp/sdd-rec-y/repo', work: '/tmp/sdd-rec-y', home: '/home/carol', user: 'carol', host: 'box', gitName: null, gitEmail: null, env: {} });
    expect(posix.sanitize('/tmp/sdd-rec-y/repo/a.ts /tmp/sdd-rec-y/last /home/carol/.claude/projects/-tmp-sdd-rec-y-repo/x')).toBe(
      '<REPO>/a.ts <WORK>/last <HOME>/.claude/projects/<REPO>/x',
    );
  });

  it('does not treat a generic user name as identifying', () => {
    const s = sanitizer({ repo: null, work: null, home: '/home/runner', user: 'runner', host: null, gitName: null, gitEmail: null, env: {} });
    expect(s.sanitize('the test runner in /home/runner/x')).toBe('the test runner in <HOME>/x');
  });

  it('writes nothing when something identifying is left', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'sdd-test-')), 'session');
    expect(() => writeSession(out, { 'a.txt': 'hello alice' }, { sanitize: (t) => t, leaks: win.leaks })).toThrow(/a\.txt: <USER>/);
    expect(existsSync(out)).toBe(false);
  });
});

describe('record-session repository lifecycle', () => {
  it('builds a deterministic base, commits the head and removes linked node_modules safely', () => {
    const shas: string[] = [];
    for (let i = 0; i < 2; i++) {
      const work = mkdtempSync(join(tmpdir(), 'sdd-test-'));
      const repo = join(work, 'repo');
      const base = prepareRepo(repo, 'ts', 'impossible');
      shas.push(base);
      expect(readdirSync(join(repo, 'test')).sort()).toEqual(['median-contract.test.ts', 'stats.test.ts']);
      // The toy runs with the linked vitest; the contradictory test fails.
      let failed = false;
      try {
        execFileSync(process.execPath, [join(repo, 'node_modules', 'vitest', 'vitest.mjs'), 'run'], { cwd: repo, stdio: 'pipe', env: { ...process.env, CI: 'true' } });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      writeFileSync(join(repo, 'src', 'extra.ts'), 'export const x = 1;\n');
      const head = commitHead(repo);
      expect(head).not.toBe(base);
      removeWork(work);
      expect(existsSync(work)).toBe(false);
      expect(existsSync(join(ROOT, 'node_modules', 'vitest', 'package.json'))).toBe(true);
    }
    expect(shas[0]).toBe(shas[1]);
  });
});
