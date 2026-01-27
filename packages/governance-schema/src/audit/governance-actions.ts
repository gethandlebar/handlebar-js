import { z } from "zod";

export const SignalSchema = z.object({
  key: z.string().max(256),
  args: z.array(z.string()).max(100).optional(),
  result: z.union([
    z.object({ ok: z.literal(false), error: z.string().optional() }),
    z.object({ ok: z.literal(true), value: z.string().max(256) }),
  ]),
});

/**
 * "hitl" effect specifically denote human-in-the-loop interventions.
 * Flow blocking/approval as a result of a decided hitl intervention should have the corresponding effect.
 */
export type GovernanceEffect = "allow" | "block" | "hitl";
type RuleAction = "allow" | "block" | "notify" | "log" | "hitl";
export type GovernanceCode =
	| "ALLOWED"
	| "ALLOWED_HITL_APPROVED"
	| "BLOCKED_UNCATEGORISED"
	| "BLOCKED_RULE"
	| "BLOCKED_CUSTOM"
	| "BLOCKED_HITL_DENIED"
	| "BLOCKED_HITL_PENDING"
	| "BLOCKED_HITL_REQUESTED" // Event exited on a hitl intervention.
	| "NO_OP";

export const AppliedActionSchema = z.object({
	type: z.custom<RuleAction>(),
	ruleId: z.string(), // uuid7-like, with prefix
});
export const GovernanceDecisionSchema = z.object({
	effect: z.custom<GovernanceEffect>(),
	code: z.custom<GovernanceCode>(),
	matchedRuleIds: z.array(z.string()), // strings are uuid7-like, with prefix
	appliedActions: z.array(AppliedActionSchema),
  reason: z.optional(z.string()),
	signals: z.array(SignalSchema).max(100).optional(),
});

export type GovernanceDecision = z.infer<typeof GovernanceDecisionSchema>;
export type AppliedAction = z.infer<typeof AppliedActionSchema>;
