import { describe, expect, it } from 'vitest';
import { parseTestFile } from '../src/parse/index.js';
import { runningTests } from '../src/rules/TG002.js';

async function running(path: string, source: string): Promise<string[]> {
  const f = await parseTestFile(path, source);
  const run = runningTests(f.tests, f.language);
  return f.tests.filter((t) => run.has(t)).map((t) => t.name);
}

describe('effective focus (TG002)', () => {
  it('runs everything without focus markers', async () => {
    expect(await running('a.test.ts', `it('a', () => {}); it('b', () => {});`)).toEqual(['a', 'b']);
  });

  it('JS/TS: a nested .only narrows its focused ancestor', async () => {
    const src = `describe.only('s', () => {
  it.only('a', () => {});
  it('b', () => {});
  describe('inner', () => { it('c', () => {}); });
});
it('outside', () => {});`;
    expect(await running('a.test.ts', src)).toEqual(['s > a']);
  });

  it('JS/TS: sibling focused suites both run', async () => {
    const src = `describe.only('x', () => { it('a', () => {}); });
describe.only('y', () => { it('b', () => {}); });
it('c', () => {});`;
    expect(await running('a.test.ts', src)).toEqual(['x > a', 'y > b']);
  });

  it('Python: every marked test runs (no narrowing)', async () => {
    const src = `import pytest
class TestA:
    pytestmark = pytest.mark.only
    @pytest.mark.only
    def test_a(self): pass
    def test_b(self): pass
def test_c(): pass
`;
    expect(await running('test_a.py', src)).toEqual(['TestA::test_a', 'TestA::test_b']);
  });
});
