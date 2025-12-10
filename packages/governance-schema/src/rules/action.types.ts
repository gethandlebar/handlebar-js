/**
 * Actions to take when a rule matches.
 * - Future: extend with "log", "notify", etc.
 */
export type RuleAction = { type: "block" } | { type: "allow" } | { type: "hitl" };
