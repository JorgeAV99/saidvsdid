export const STORAGE_KEY = 'gate';

export function resolveAccess(stored: string | null): boolean {
  return stored !== null && stored.includes('@');
}
