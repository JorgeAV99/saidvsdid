import { TG001 } from './TG001.js';
import { TG002 } from './TG002.js';
import { TG003 } from './TG003.js';
import { TG004 } from './TG004.js';
import { TG005 } from './TG005.js';
import { TG006 } from './TG006.js';
import { TG007 } from './TG007.js';
import { RULE_IDS, type Rule, type RuleId } from './types.js';

export type { CheckContext, F2pOptions, Finding, Rule, RuleId, Severity } from './types.js';
export { RULE_IDS } from './types.js';

/** Rules implemented in this version. TG006 and TG007 need evidence (--transcript or --evidence). */
export const RULES: readonly Rule[] = [TG001, TG002, TG003, TG004, TG005, TG006, TG007];

/** Rules that judge an agent's claims against evidence: marked experimental in the docs and the output. */
export const EXPERIMENTAL: ReadonlySet<RuleId> = new Set<RuleId>(['TG006', 'TG007']);

export function isRuleId(value: string): value is RuleId {
  return (RULE_IDS as readonly string[]).includes(value);
}
