// INI files as pytest reads them (pytest.ini, setup.cfg, tox.ini): sections,
// `key = value` / `key: value`, indented continuation lines, and full-line
// `#` / `;` comments.

export interface IniEntry {
  value: string;
  /** 1-based line of the key. */
  line: number;
}

export type Ini = Map<string, Map<string, IniEntry>>;

export function parseIni(text: string): Ini {
  const out: Ini = new Map();
  let section: Map<string, IniEntry> | null = null;
  let last: IniEntry | null = null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      if (trimmed === '') last = null;
      return;
    }
    if (/^\s/.test(raw) && last) {
      last.value += `\n${trimmed}`;
      return;
    }
    const header = /^\[([^\]]+)\]\s*$/.exec(trimmed);
    if (header) {
      section = new Map();
      out.set(header[1]!.trim(), section);
      last = null;
      return;
    }
    const kv = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(trimmed);
    if (kv && section) {
      last = { value: kv[2]!, line: i + 1 };
      section.set(kv[1]!.trim(), last);
    }
  });
  return out;
}
