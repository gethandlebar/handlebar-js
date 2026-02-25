import { z } from "zod";

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
