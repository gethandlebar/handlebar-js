/**
 * Actions to take when a rule matches.
 * - Future: extend with "log", "notify", "humanInTheLoop", etc.
 */
export type RuleAction = { type: "block" } | { type: "allow" };
