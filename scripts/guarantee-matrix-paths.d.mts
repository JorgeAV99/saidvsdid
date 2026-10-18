export const EXCLUDED: readonly string[];
export const NOT_EXCLUDED: readonly string[];
export const DOCS: readonly string[];
export const RUNNER_EVIDENCE: readonly string[];
export function excluded(path: string, list?: readonly string[]): boolean;
export function changedPaths(base: string, head: string, cwd?: string): string[];
export function decide(base: string, head: string, cwd?: string, list?: readonly string[]): { run: boolean; paths: string[]; why: string };
