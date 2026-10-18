// Pairs tests at base with tests at head so rules can reason about "the same
// test" across renames and moves. Deterministic: ties are broken by path/line.
import { compareStr } from '../git/diff.js';
import type { TestCase, TestFile } from '../parse/index.js';

export interface TestRef {
  /** Path on its own side of the diff. */
  file: string;
  test: TestCase;
}

export interface Pair {
  base: TestRef;
  head: TestRef;
  nameChanged: boolean;
  /** Moved to a different file (a plain file rename does not count). */
  fileChanged: boolean;
  /** Body similarity in [0, 1]; 1 for identical bodies. */
  similarity: number;
}

/** A base test whose every assertion reappears, spread over two or more tests added to its file. */
export interface Split {
  base: TestRef;
  heads: TestRef[];
}

export interface Matching {
  pairs: Pair[];
  splits: Split[];
  /** A removed test and an unrelated test added in the same file. */
  substitutions: Pair[];
  removed: TestRef[];
  added: TestRef[];
}

/** Minimum body similarity for a name change to count as a rename. */
export const RENAME_THRESHOLD = 0.6;
/** Minimum body similarity for a same-name test in another file to count as a move. */
export const MOVE_THRESHOLD = 0.4;

function tokens(body: string): Set<string> {
  return new Set(body.split(/[^A-Za-z0-9_$]+/).filter((t) => t.length > 0));
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function refOrder(a: TestRef, b: TestRef): number {
  return compareStr(a.file, b.file) || a.test.line - b.test.line || compareStr(a.test.name, b.test.name);
}

export function matchTests(
  baseFiles: Map<string, TestFile>,
  headFiles: Map<string, TestFile>,
  renames: Map<string, string>,
): Matching {
  const mapped = (basePath: string): string => renames.get(basePath) ?? basePath;
  const pairs: Pair[] = [];

  // 1. Exact identity: same (mapped) file and same name, as a multiset.
  const headByKey = new Map<string, TestRef[]>();
  const headRefs: TestRef[] = [];
  for (const [path, file] of [...headFiles].sort(([a], [b]) => compareStr(a, b))) {
    for (const test of file.tests) {
      const ref = { file: path, test };
      headRefs.push(ref);
      const key = `${path}\0${test.name}`;
      headByKey.set(key, [...(headByKey.get(key) ?? []), ref]);
    }
  }
  const matchedHead = new Set<TestRef>();
  let removed: TestRef[] = [];
  for (const [path, file] of [...baseFiles].sort(([a], [b]) => compareStr(a, b))) {
    for (const test of file.tests) {
      const ref = { file: path, test };
      const candidates = headByKey.get(`${mapped(path)}\0${test.name}`);
      const head = candidates?.shift();
      if (head) {
        matchedHead.add(head);
        pairs.push({
          base: ref,
          head,
          nameChanged: false,
          fileChanged: false,
          similarity: similarity(test.body, head.test.body),
        });
      } else {
        removed.push(ref);
      }
    }
  }
  let added = headRefs.filter((r) => !matchedHead.has(r));

  // 2. Renames and moves, best score first.
  const candidates: Pair[] = [];
  for (const r of removed) {
    for (const a of added) {
      const sameFile = mapped(r.file) === a.file;
      const sameName = r.test.name === a.test.name;
      const sim = similarity(r.test.body, a.test.body);
      const identical = r.test.body.length > 0 && r.test.body === a.test.body;
      const ok = identical || (sameName && !sameFile ? sim >= MOVE_THRESHOLD : sim >= RENAME_THRESHOLD);
      if (!ok || (r.test.body.length === 0 && !sameName)) continue;
      candidates.push({ base: r, head: a, nameChanged: !sameName, fileChanged: !sameFile, similarity: sim });
    }
  }
  candidates.sort(
    (x, y) =>
      y.similarity - x.similarity ||
      Number(x.nameChanged) - Number(y.nameChanged) ||
      refOrder(x.base, y.base) ||
      refOrder(x.head, y.head),
  );
  const usedBase = new Set<TestRef>();
  const usedHead = new Set<TestRef>();
  for (const c of candidates) {
    if (usedBase.has(c.base) || usedHead.has(c.head)) continue;
    usedBase.add(c.base);
    usedHead.add(c.head);
    pairs.push(c);
  }
  removed = removed.filter((r) => !usedBase.has(r));
  added = added.filter((a) => !usedHead.has(a));

  // 3. Splits: every assertion of a removed test reappears in two or more
  //    tests added to the same file.
  const splits: Split[] = [];
  for (const r of [...removed].sort(refOrder)) {
    const wanted = r.test.assertionSites.map((a) => a.text);
    if (wanted.length === 0) continue;
    const heads: TestRef[] = [];
    for (const a of added.filter((x) => x.file === mapped(r.file)).sort(refOrder)) {
      const texts = a.test.assertionSites.map((x) => x.text);
      const hits = wanted.filter((w) => texts.includes(w));
      if (hits.length === 0) continue;
      heads.push(a);
      for (const h of hits) wanted.splice(wanted.indexOf(h), 1);
      if (wanted.length === 0) break;
    }
    if (wanted.length > 0 || heads.length < 2) continue;
    splits.push({ base: r, heads });
    removed = removed.filter((x) => x !== r);
    added = added.filter((x) => !heads.includes(x));
  }

  // 4. Substitutions: whatever is still removed, paired in line order with
  //    unrelated tests added to the same file.
  const substitutions: Pair[] = [];
  const addedByFile = new Map<string, TestRef[]>();
  for (const a of [...added].sort(refOrder)) addedByFile.set(a.file, [...(addedByFile.get(a.file) ?? []), a]);
  const stillRemoved: TestRef[] = [];
  for (const r of [...removed].sort(refOrder)) {
    const a = addedByFile.get(mapped(r.file))?.shift();
    if (a) {
      substitutions.push({ base: r, head: a, nameChanged: true, fileChanged: false, similarity: similarity(r.test.body, a.test.body) });
    } else {
      stillRemoved.push(r);
    }
  }
  const substitutedHead = new Set(substitutions.map((s) => s.head));

  return {
    pairs: pairs.sort((x, y) => refOrder(x.head, y.head)),
    splits,
    substitutions,
    removed: stillRemoved,
    added: added.filter((a) => !substitutedHead.has(a)).sort(refOrder),
  };
}
