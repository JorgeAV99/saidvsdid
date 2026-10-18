// Without a Python that reads the file (none found here: SAIDVSDID_PYTHON names one that does not
// exist), nothing in a Python test file is certainly the runner's: no FAIL, and the file gets one WARN
// saying why — never silence. The interpreter is looked for once per process, and vitest runs each
// test file in its own module registry, so the setting holds for this file only.
import { describe, expect, it } from 'vitest';

process.env['SAIDVSDID_PYTHON'] = 'saidvsdid-no-such-python';
const { analyze } = await import('../src/check.js');

describe('no Python interpreter', () => {
  it('a certain skip becomes a WARN, and the file says why once', async () => {
    const base = 'import pytest\n\n\ndef test_t():\n    assert 1 == 1\n';
    const head = 'import pytest\n\n\ndef test_t():\n    pytest.skip("x")\n    assert 1 == 1\n';
    const report = await analyze({
      base: '0'.repeat(40),
      head: '1'.repeat(40),
      changes: [{ status: 'M', basePath: 'test_a.py', headPath: 'test_a.py' }],
      read: (side, path) => (path === 'test_a.py' ? (side === 'base' ? base : head) : null),
    });
    expect(report.verdict).toBe('WARN');
    expect(report.findings.map((f) => [f.rule, f.severity, f.line, f.reason ?? null])).toEqual([
      ['TG003', 'warn', null, 'scope_unavailable'],
      ['TG003', 'warn', 5, null],
    ]);
    expect(report.findings[0]!.message).toMatch(/no Python interpreter runs the scope reader/);
    expect(report.tool.scopes?.python).toBeNull();
    expect(report.tool.scopes?.python_unavailable).toMatch(/SAIDVSDID_PYTHON/);
  });
});
