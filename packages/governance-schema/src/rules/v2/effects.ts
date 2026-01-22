export type RuleEffectKind = "allow" | "hitl" | "block";

/**
 * Direct impact of a rule breach.
 *
 * RuleEffect has an immediate impact on the agent run/tool action.
 * This is in contract to side effects (yet to be defined),
 * which would include "log" or "modify context".
 */
export type RuleEffectV2 =
	| { type: "allow" }
	| { type: "hitl"; reason?: string } // Supercedes "allow"
	| { type: "block"; reason?: string }; // Supercedes "hitl"
// Possible future expansions.
// | { type: "require_step"; toolName: string; withinSeconds?: number; reason?: string }
// | { type: "redact"; fields: string[]; reason?: string };
