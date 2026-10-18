// "Unknown is a type, not a null": a working directory, a location or a run's
// outcome is a discriminated union (known | unknown with a reason) and is never
// defaulted. This guard fails if `??` or `||` is applied to one of them in the
// source (e.g. `ev.cwd ?? sessionCwd`, the fallback the eighth review found).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });

// An identifier naming a cwd, a location or an outcome (with member accesses or a call), then `??` or `||`.
const FALLBACK = /\b\w*(?:cwd|Cwd|location|Location|outcome|Outcome)\w*(?:\??\.\w+|\[[^\]]+\]|\([^)]*\))*\s*(?:\?\?|\|\|)/;

describe('no default for an unknown directory, location or outcome', () => {
  it('src/ applies no ?? or || to them', () => {
    const found: string[] = [];
    for (const file of walk(join(__dirname, '..', 'src'))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!/^\s*(\/\/|\*)/.test(line) && FALLBACK.test(line)) found.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(found).toEqual([]);
  });

  it('the guard catches the fallback the review found', () => {
    expect(FALLBACK.test('    const callCwd = ev.cwd ?? (persistent ? shellCwd : sessionCwd);')).toBe(true);
    expect(FALLBACK.test('  const where = runLocation(r) || fallback;')).toBe(true);
    expect(FALLBACK.test('  const callCwd: Cwd = ev.cwd !== undefined ? ev.cwd : sessionCwd;')).toBe(false);
  });
});
