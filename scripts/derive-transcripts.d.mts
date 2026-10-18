// Types for the part of derive-transcripts.mjs that test/transcripts.test.ts uses.
/** Every file the recipes produce, keyed by path relative to fixtures/cases. */
export function derive(): Record<string, string>;
