/**
 * Minimal gitignore-flavoured glob: `**` spans directories, `*` and `?` stay
 * within one segment, a pattern without `/` matches the basename anywhere and a
 * trailing `/` matches everything below a directory.
 */
export function globToRegExp(glob: string): RegExp {
  let g = glob.replace(/\\/g, '/');
  if (g.endsWith('/')) g += '**';
  const anchored = g.includes('/');
  if (g.startsWith('/')) g = g.slice(1);
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') {
        const slash = g[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(anchored ? `^${re}$` : `(?:^|/)${re}$`);
}

export function matchesAny(path: string, globs: RegExp[]): boolean {
  const p = path.replace(/\\/g, '/');
  return globs.some((g) => g.test(p));
}
