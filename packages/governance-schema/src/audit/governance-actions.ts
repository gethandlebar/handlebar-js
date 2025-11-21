import { z } from "zod";

export type GovernanceEffect = "allow" | "block";
type RuleAction = "allow" | "block" | "notify" | "log" | "hitl";
export type GovernanceCode =
	| "BLOCKED_UNCATEGORISED"
	| "BLOCKED_RULE"
	| "BLOCKED_CUSTOM"
	| "ALLOWED"
	| "NO_OP";

export const AppliedActionSchema = z.object({
	type: z.custom<RuleAction>(),
	ruleId: z.uuidv7(),
});
export const GovernanceDecisionSchema = z.object({
	effect: z.custom<GovernanceEffect>(),
	code: z.custom<GovernanceCode>(),
	matchedRuleIds: z.array(z.uuidv7()),
	appliedActions: z.array(AppliedActionSchema),
	reason: z.optional(z.string()),
});

export type GovernanceDecision = z.infer<typeof GovernanceDecisionSchema>;
export type AppliedAction = z.infer<typeof AppliedActionSchema>;
