export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function slug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-');
}
