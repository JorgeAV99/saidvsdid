export interface FullCiRun {
  id: number;
  head_sha: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  jobs: { name: string; conclusion: string | null }[];
}
export interface Scope {
  matrix: boolean;
  platform: boolean;
  evidence: boolean;
}
export const REQUIRED_JOBS: { matrix: string; platform: string; evidence: string };
export function passingRun<R extends FullCiRun>(sha: string, runs: R[], scope?: Scope): R | null;
export function mergeVerdict<R extends FullCiRun>(input: { sha: string; runs: R[]; behindBy: unknown; base: string; scope: Scope | null }): { ok: boolean; run: R | null; why: string };
