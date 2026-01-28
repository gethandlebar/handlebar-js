import { z } from "zod";
import { GlobSchema } from "./common";
import { RuleConditionSchema } from "./condition";
import { RuleEffectKindSchema, RuleEffectSchema } from "./effects";

export const RulePhaseSchema = z.enum(["tool.before", "tool.after"]);
export type RulePhase = z.infer<typeof RulePhaseSchema>;

export const RuleSelectorSchema = z
	.object({
		phase: RulePhaseSchema,
		tool: z
			.object({
				name: z.union([GlobSchema, z.array(GlobSchema).min(1)]).optional(),
				tagsAll: z.array(z.string().min(1)).min(1).optional(),
				tagsAny: z.array(z.string().min(1)).min(1).optional(),
			})
			.strict()
			.optional(),
	})
	.strict()
	.refine(
		(v) => !!v.tool,
		"selector.tool is required (rule will never evaluate otherwise)",
	);
export type RuleSelector = z.infer<typeof RuleSelectorSchema>;

export const RuleSchema = z
	.object({
		id: z.string().min(1),
		policyId: z.string().min(1),
		enabled: z.boolean(),
		priority: z.number().int(),
		name: z.string().min(1).max(200),
		selector: RuleSelectorSchema,
		condition: RuleConditionSchema,
		effect: RuleEffectSchema,
		onMissing: RuleEffectKindSchema.optional(),
	})
	.strict();
export type Rule = z.infer<typeof RuleSchema>;

export const RuleSpecSchema = RuleSchema.omit({
	id: true,
	policyId: true,
}).describe("Definable Rule spec that can be inserted into Handlebar API");
