import { z } from "zod";

export const AgentSelectorSchema = z
	.object({
		anyOfSlugs: z.array(z.string().min(1)).min(1).optional(),
		anyOfTags: z.array(z.string().min(1)).min(1).optional(),
		allOfTags: z.array(z.string().min(1)).min(1).optional(),
	})
	.strict();

export const PolicySpecSchema = z
	.object({
		name: z.string().min(1).max(100),
		description: z.string().min(1).max(500).optional(),
		agentSelector: AgentSelectorSchema,
		enabled: z.boolean().optional(),
		mode: z.union([z.literal("enforce"), z.literal("shadow")]),
		combine: z.literal("most_severe_wins"),
		onMissingDefault: z
			.union([z.literal("allow"), z.literal("hitl"), z.literal("block")])
			.optional(),
	})
	.describe("Definable Policy spec that can be inserted into Handlebar API");
