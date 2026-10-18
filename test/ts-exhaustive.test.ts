// Exhaustiveness of the TypeScript reading (src/parse/ts-binding.ts) against the compiler itself:
// - every SyntaxKind the compiler counts as a declaration is classified in TS_DECLARATIONS (import,
//   value, none), and every classified name is a SyntaxKind;
// - every assignment operator the compiler has (FirstAssignment..LastAssignment) gives a name a value
//   the alias rules read;
// - a probe for each binding form with a value: the alias it makes is read (at least a WARN), never
//   silence. A value taken out of a container (`const { a: { skip: omit } } = { a: it }`) or passed on
//   is coverage (docs/rules.md), not probed.
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parseTestFile } from '../src/parse/index.js';
import { EXACT_ASSIGNMENTS, TS_DECLARATIONS, isAssignmentOperator } from '../src/parse/ts-binding.js';

const KINDS = Object.entries(ts.SyntaxKind).filter(([name, v]) => typeof v === 'number' && !/^(First|Last)/.test(name)) as Array<[string, number]>;

/** The marker the extractor reads on test 'adds', and its certainty. */
async function adds(source: string, path = 'a.test.ts'): Promise<string> {
  const f = await parseTestFile(path, source);
  const t = f.tests.find((x) => x.name === 'adds');
  const m = t?.markers.find((x) => x.kind === 'skip');
  return !t ? 'no test' : !m ? 'no marker' : m.binding.certain ? 'certain' : 'uncertain';
}

describe('TS_DECLARATIONS covers every declaration kind of the compiler', () => {
  it('classifies each SyntaxKind ts.isDeclaration accepts', () => {
    const isDeclaration = (ts as unknown as { isDeclaration?: (n: { kind: number; parent: { kind: number } }) => boolean }).isDeclaration;
    expect(typeof isDeclaration, 'the compiler exposes isDeclaration').toBe('function');
    const declarations = KINDS.filter(([, kind]) => isDeclaration!({ kind, parent: { kind: ts.SyntaxKind.SourceFile } })).map(([name]) => name);
    expect(declarations.length).toBeGreaterThan(30);
    expect(declarations.filter((name) => !(name in TS_DECLARATIONS))).toEqual([]);
  });

  it('names only real SyntaxKinds', () => {
    const names = new Set(KINDS.map(([name]) => name));
    expect(Object.keys(TS_DECLARATIONS).filter((name) => !names.has(name))).toEqual([]);
  });
});

describe('every assignment operator is a binding with a value', () => {
  const operators = KINDS.filter(([, kind]) => isAssignmentOperator(kind));
  it('knows the compiler\'s operators', () => {
    expect(operators.map(([name]) => name)).toContain('QuestionQuestionEqualsToken');
    expect(operators.length).toBe(ts.SyntaxKind.LastAssignment - ts.SyntaxKind.FirstAssignment + 1);
    expect([...EXACT_ASSIGNMENTS].every(isAssignmentOperator)).toBe(true);
  });
  it.each(operators.map(([name, kind]) => [name, ts.tokenToString(kind as ts.SyntaxKind)!]))('%s (`%s`): a use of the name is read as the alias', async (_name, op) => {
    expect(await adds(`import { it } from 'vitest';\nlet omit: any;\nomit ${op} it.skip;\nomit('adds', () => {});\n`)).toBe('uncertain');
  });
});

/** The skip marker the extractor reads on test 'adds' from a body that calls `omit()` (`P` is the context parameter), and its certainty. */
async function contextSkip(body: string, runner: 'node:test' | 'vitest', param: 't' | 'ctx'): Promise<string> {
  const f = await parseTestFile('a.test.ts', `import { test } from '${runner}';\ntest('adds', (${param}: any) => {\n${body.replaceAll('P', param)}\n  omit();\n});\n`);
  const m = f.tests.find((x) => x.name === 'adds')?.markers.find((x) => x.kind === 'skip');
  return !m ? 'no marker' : m.binding.certain ? 'certain' : 'uncertain';
}
const CONTEXTS = [['node:test', 't'], ['vitest', 'ctx']] as const;

describe('a binding rooted in the test context (node:test `t`, vitest `ctx`) makes an alias the same way', () => {
  const operators = KINDS.filter(([, kind]) => isAssignmentOperator(kind));
  it.each(operators.flatMap(([name, kind]) => CONTEXTS.map(([runner, param]) => [name, ts.tokenToString(kind as ts.SyntaxKind)!, runner, param] as const)))(
    '%s (`%s`) on the context\'s `skip.bind`, %s',
    async (_name, op, runner, param) => {
      expect(await contextSkip(`  let omit: any;\n  omit ${op} P.skip.bind(P);`, runner, param)).toBe('uncertain');
    },
  );
  const forms = [
    ['a declaration', '  const omit = P.skip;'],
    ['a declaration of a bound copy', '  const omit = P.skip.bind(P);'],
    ['an array destructuring default', '  const [omit = P.skip.bind(P)] = [];'],
    ['an object destructuring default', '  const { omit = P.skip } = {} as any;'],
    ['a destructured member', '  const { skip: omit } = P;'],
    ['a destructured member under a literal computed key', "  const { ['skip']: omit } = P;"],
    ['a destructured member under a computed key in parentheses', "  const { [('skip')]: omit } = P;"],
    ['a destructured member under a computed key `as const`', "  const { ['skip' as const]: omit } = P;"],
    ['a destructuring assignment', '  let omit: any;\n  ({ skip: omit } = P);'],
    ['an array destructuring assignment', '  let omit: any;\n  [omit] = [P.skip];'],
    ['a default in a destructuring assignment', '  let omit: any;\n  [omit = P.skip] = [];'],
    ['a for … of', '  let omit: any;\n  for (omit of [P.skip]) break;'],
  ] as const;
  it.each(forms.flatMap(([why, body]) => CONTEXTS.map(([runner, param]) => [why, runner, body, param] as const)))('%s, %s', async (_why, runner, body, param) => {
    expect(await contextSkip(body, runner, param)).toBe('uncertain');
  });
  it('the context itself, called through its own name, stays certain (control)', async () => {
    const f = await parseTestFile('a.test.ts', "import { test } from 'vitest';\ntest('adds', (ctx) => {\n  ctx.skip();\n});\n");
    expect(f.tests[0]!.markers.map((m) => m.binding.certain)).toEqual([true]);
  });
});

describe('each binding form with a value makes an alias (never silence)', () => {
  it.each([
    ['a declaration', `const omit = it.skip;`],
    ['a declaration through parentheses and `as`', `const omit = (it.skip as typeof it.skip)!;`],
    ['a value that contains the form', `const omit = [it.skip][0];`],
    ['a destructuring default', `const { omit = it.skip } = {} as { omit?: typeof it.skip };`],
    ['an array destructuring default', `const [omit = it.skip] = [] as Array<typeof it.skip>;`],
    ['a destructured member', `const { skip: omit } = it;`],
    ['a destructured member under a literal computed key', `const { ['skip']: omit } = it;`],
    ['a destructured member under a computed key in parentheses', `const { [('skip')]: omit } = it;`],
    ['a destructured member under a computed key `as const`', `const { ['skip' as const]: omit } = it;`],
    ['an assignment', `let omit: any;\nomit = it.skip;`],
    ['a logical assignment', `let omit: any;\nomit ??= it.skip;`],
    ['a destructuring assignment', `let omit: any;\n({ skip: omit } = it);`],
    ['an array destructuring assignment', `let omit: any;\n[omit] = [it.skip];`],
    ['a default in a destructuring assignment', `let omit: any;\n({ omit = it.skip } = {} as any);`],
    ['a for … of', `for (const omit of [it.skip]) {\n  omit('adds', () => {});\n}\nconst unused = 0;`],
  ])('%s', async (_why, binding) => {
    const use = binding.includes("omit('adds'") ? '' : "\nomit('adds', () => {});\n";
    expect(await adds(`import { it } from 'vitest';\n${binding}${use}`)).toBe('uncertain');
  });

  it.each([
    ['a parameter default', `function declare(omit = it.skip) {\n  omit('adds', () => {});\n}\ndeclare();\n`],
    ['a parameter destructuring default', `function declare({ omit = it.skip } = {} as any) {\n  omit('adds', () => {});\n}\ndeclare();\n`],
    ['the test context destructured', `it('outer', ({ skip: omit }) => {\n  omit();\n});\nit('adds', () => {});\n`],
  ])('%s', async (_why, source) => {
    const f = await parseTestFile('a.test.ts', `import { it } from 'vitest';\n${source}`);
    const markers = f.tests.flatMap((t) => t.markers).concat();
    const sites = f.markerSites.filter((s) => s.kind === 'skip');
    // Read as a marker (attributed or not): at least a WARN, never silence.
    expect(markers.length + sites.length).toBeGreaterThan(0);
    expect(markers.every((m) => !m.binding.certain)).toBe(true);
  });
});

describe('a file the compiler rejects is read for nothing', () => {
  it('a duplicate declaration (the binder\'s error): nothing certain, the file says why', async () => {
    const f = await parseTestFile('a.test.ts', `import { it } from 'vitest';\nlet x = 1;\nlet x = 2;\nit.skip('adds', () => {});\n`);
    expect(f.scopes).toEqual({ known: false, why: expect.stringMatching(/rejects the file's declarations/) });
    expect(f.tests[0]!.markers[0]!.binding.certain).toBe(false);
  });
  it('a merged declaration (`namespace it` beside the import)', async () => {
    expect(await adds(`import { it } from 'vitest';\nnamespace it { export const x = 1; }\nit.skip('adds', () => {});\n`)).toBe('uncertain');
  });
  it('the import itself, read by the compiler: certain', async () => {
    expect(await adds(`import { it } from 'vitest';\nit.skip('adds', () => {});\n`)).toBe('certain');
  });
});
