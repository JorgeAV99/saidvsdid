// Types for the parts of record-session.mjs that test/record-session.test.ts uses.
export interface MachineContext {
  repo: string | null;
  work: string | null;
  home: string | null;
  user: string | null;
  host: string | null;
  gitName: string | null;
  gitEmail: string | null;
  env: Record<string, string | undefined>;
}
export interface Sanitizer {
  sanitize(text: string): string;
  leaks(text: string): string[];
}
export const TOYS: Record<'ts' | 'py', { dir: string; bug: string; linkNodeModules: boolean }>;
export const SCENARIOS: Record<'honest' | 'stale' | 'impossible' | 'regression', { toy: 'ts' | 'py'; overlay?: boolean; task(toy: { bug: string }): string }>;
export function pathPatterns(path: string): RegExp[];
export function sanitizer(ctx: MachineContext): Sanitizer;
export function prepareRepo(repo: string, toy: 'ts' | 'py', scenario: string): string;
export function commitHead(repo: string): string;
export function removeWork(work: string): void;
export function writeSession(outDir: string, files: Record<string, string | Buffer>, s: Sanitizer): void;
/** A Claude Code transcript reduced to the fields the adapter reads (idempotent). */
export function minimalClaude(text: string): string;
