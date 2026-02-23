import { z } from "zod";

// ---------------------------------------------------------------------------
// New core decision types (new_core)
// ---------------------------------------------------------------------------

export const VerdictSchema = z.enum(["ALLOW", "BLOCK"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const RunControlSchema = z.enum(["CONTINUE", "TERMINATE"]);
export type RunControl = z.infer<typeof RunControlSchema>;

export const DecisionCauseSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("ALLOW") }),
	z.object({ kind: z.literal("RULE_VIOLATION"), ruleId: z.string() }),
	z.object({
		kind: z.literal("HITL_PENDING"),
		approvalId: z.string(),
		ruleId: z.string().optional(),
	}),
	z.object({
		kind: z.literal("LOCKDOWN"),
		lockdownId: z.string().optional(),
	}),
]);
export type DecisionCause = z.infer<typeof DecisionCauseSchema>;

export const RuleEvalSchema = z.object({
	ruleId: z.string(),
	enabled: z.boolean(),
	matched: z.boolean(),
	violated: z.boolean(),
});
export type RuleEval = z.infer<typeof RuleEvalSchema>;

export const DecisionSchema = z.object({
	verdict: VerdictSchema,
	control: RunControlSchema,
	cause: DecisionCauseSchema,
	message: z.string(),
	evaluatedRules: z.array(RuleEvalSchema),
	finalRuleId: z.string().optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

// ---------------------------------------------------------------------------
// Legacy decision types (GovernanceEngine / old core)
// ---------------------------------------------------------------------------

export const SignalSchema = z.object({
	key: z.string().max(256),
	args: z.array(z.string().max(256)).max(100).optional(),
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
