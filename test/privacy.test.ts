// No versioned file carries personal data: not the fixtures and transcripts alone, but every file in
// git's index (docs, README, scripts, sources, tests, fixtures): tracked, or staged with `git add`.
// Untracked files are not read: what a local tool or another process leaves in the working tree is
// not versioned, and a scan of it fails on files nobody will commit. A new file is scanned once it is
// staged, and in CI, where every file is committed. Real home directories, email addresses, account
// ids and tokens are leaks; examples use the closed lists below.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

/** Every file in git's index: tracked or staged. Untracked files are not versioned and are not read. */
function versionedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: ROOT, encoding: 'utf8' });
  return [...new Set(out.split('\0').filter(Boolean))].sort();
}

/**
 * Binary files, by a closed list of extensions (the tree-sitter grammars, the README's screenshot): every other file is
 * text and is read. A PNG's pixels cannot be read here (whoever adds one looks at it); its chunks are checked below.
 */
const BINARY = /\.(wasm|png)$/i;

/** The chunks a PNG may hold: image data only, no text (tEXt, zTXt, iTXt), EXIF (eXIf) or any other metadata. */
const PNG_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

/** A PNG's chunk types in order, or null when it is not a well-formed PNG. */
function pngChunks(buf: Buffer): string[] | null {
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  const types: string[] = [];
  let i = 8;
  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i);
    types.push(buf.toString('latin1', i + 4, i + 8));
    i += 12 + length;
  }
  return i === buf.length && types.at(-1) === 'IEND' ? types : null;
}

/** Every versioned file but the binaries, as text: a NUL byte does not make a file binary (it is a finding). */
function texts(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const path of versionedFiles()) {
    if (BINARY.test(path)) continue;
    let buf: Buffer;
    try {
      buf = readFileSync(join(ROOT, path));
    } catch {
      continue; // deleted in the working tree
    }
    out.push({ path, text: buf.toString('utf8') });
  }
  return out;
}

/** Home directories examples may use (compared without case): anything else is someone's. */
const SYNTHETIC_HOMES = new Set(['a', 'x', 'u', 'alice', 'bob', 'carol', 'agent', 'runner', 'user', 'me']);
/** Domains reserved for examples (RFC 2606, RFC 6761) and this project's own fixture identities. */
const RESERVED_DOMAIN = /(?:^|\.)(?:example(?:\.(?:com|org|net))?|invalid|test|localhost)$/i;
/** Addresses published by third parties in the files they generate: allowed only there. */
const THIRD_PARTY_EMAILS: Record<string, string> = { ['i' + '@izs.me']: 'package-lock.json' };

/** Home directories: `C:\Users\<name>`, `C:/Users/<name>` (JSON-escaped too), `/home/<name>`, `/Users/<name>`. */
function homes(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)([^\\/"'`\s<>*]+)/gi)) out.push(m[1]!);
  for (const m of text.matchAll(/(?<![\w<>.:\\/-])\/(?:home|Users)\/([A-Za-z][^/"'`\s<>*]*)/g)) out.push(m[1]!);
  return out.map((n) => n.replace(/[,.;:)\]}]+$/, ''));
}

function emails(text: string): string[] {
  const re = /(?<![\\\w.%+-])[\w.%+-]+@([\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|dev|ai|es|co|me|edu|info|app|cloud|uk|de|fr|eu|us|ca|gov|example|invalid|test|localhost))\b/gi;
  return [...text.matchAll(re)].filter((m) => !RESERVED_DOMAIN.test(m[1]!)).map((m) => m[0]);
}

/** An account, organisation, user or device id with a value that looks real (a UUID, a long opaque id). */
const ACCOUNT_ID = /["']?(?:account|organi[sz]ation|org|user|device|creator_user|creator_account)_?(?:uuid|id)["']?\s*[:=]\s*["']?(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{20,})/i;
const TOKEN = /sk-ant-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}/;

describe('privacy of every versioned file', () => {
  const files = texts();

  it('covers the docs, the README, the scripts and the fixtures', () => {
    const paths = files.map((f) => f.path);
    for (const p of ['README.md', 'CLAUDE.md', 'docs/backlog.md', 'docs/rules.md', 'scripts/record-session.mjs', 'package.json', 'src/rules/TG004.ts']) expect(paths).toContain(p);
    expect(paths.some((p) => p.startsWith('fixtures/cases/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('fixtures/sessions/'))).toBe(true);
  });

  it('no file names a real home directory', () => {
    const found = files.flatMap((f) => homes(f.text).filter((n) => !SYNTHETIC_HOMES.has(n.toLowerCase())).map((n) => `${f.path}: ${n}`));
    expect(found).toEqual([]);
  });

  it('no file holds an email address outside the reserved example domains', () => {
    const found = files.flatMap((f) => emails(f.text).filter((e) => THIRD_PARTY_EMAILS[e] !== f.path).map((e) => `${f.path}: ${e}`));
    expect(found).toEqual([]);
  });

  it('no text file holds a NUL byte (a scanner must not take it for a binary and skip it)', () => {
    expect(files.filter((f) => f.text.includes(String.fromCharCode(0))).map((f) => f.path)).toEqual([]);
  });

  it('a PNG holds image data only: no text, EXIF or other metadata chunk', () => {
    const found = versionedFiles()
      .filter((path) => /\.png$/i.test(path))
      .filter((path) => {
        const chunks = pngChunks(readFileSync(join(ROOT, path)));
        return chunks === null || chunks.some((c) => !PNG_CHUNKS.has(c));
      });
    expect(found).toEqual([]);
  });

  it('no file holds an account, organisation or device id, or a token', () => {
    const found = files.filter((f) => ACCOUNT_ID.test(f.text) || TOKEN.test(f.text)).map((f) => f.path);
    expect(found).toEqual([]);
  });

  it('the checks see what they are for', () => {
    // Built at run time, so that this file holds none of them.
    const name = (n: number): string => ['Some', 'one', String(n)].join('');
    const [win, json] = [String.raw`C:\Users\\`.slice(0, -1), String.raw`C:\\Users\\`];
    expect(homes(`${win}${name(1)}\\repo and "${json}${name(2)}\\\\x" and /home/${name(3)}/x and /Users/${name(4)}`)).toEqual([1, 2, 3, 4].map(name));
    expect(homes('<HOME>/x, /tmp/home/x, C:/Users/<USER>')).toEqual([]);
    const mail = ['someone', 'gmail.com'].join('@');
    expect(emails(`mail ${mail}, not alice@wonder.example, fixtures@saidvsdid.invalid, toy-stats@0.0.0 or \\n@pytest.mark.skip`)).toEqual([mail]);
    expect(ACCOUNT_ID.test('"organizationUuid":"' + ['0b5b7a3e', '1c2d', '4e5f', '8a9b', '0c1d2e3f4a5b'].join('-') + '"')).toBe(true);
    expect(ACCOUNT_ID.test('"account_id":"a1"')).toBe(false);
    expect(TOKEN.test('ghp_' + 'A'.repeat(36))).toBe(true);
  });
});
