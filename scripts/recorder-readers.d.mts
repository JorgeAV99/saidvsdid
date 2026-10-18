export class Unrecordable extends Error {
  constructor(reason: string);
  readonly reason: string;
}
export function identity(seen: Map<string, number>, dir: string, file: string, name: string): string;
export function readVitest(report: unknown, modes: unknown[], dir: string, exit: number): Map<string, string>;
export function vitestFailsWithExtend(sources: string[]): boolean;
export function readJest(report: unknown, dir: string, exit: number): Map<string, string>;
export function readPlaywright(report: unknown, dir: string, exit: number, steps: unknown): Map<string, string>;
export function readNode(reply: unknown, exit: number): Record<string, string>;
export function readReply(reply: unknown, runner: string): Record<string, string>;
