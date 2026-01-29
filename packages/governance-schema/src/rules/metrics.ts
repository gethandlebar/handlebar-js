import { z } from "zod";
import { InbuiltAgentMetricKind } from "../audit/run-metrics";
import { GlobSchema } from "./common";
import { RuleEffectKindSchema } from "./effects";

export const MetricRefSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("inbuilt"), key: InbuiltAgentMetricKind })
		.strict(),
	z.object({ kind: z.literal("custom"), key: z.string().min(1) }).strict(),
]);
export type MetricRef = z.infer<typeof MetricRefSchema>;

export const MetricWindowConditionSchema = z
	.object({
		kind: z.literal("metricWindow"),
		scope: z.enum(["agent", "agent_user"]),
		metric: MetricRefSchema,
		aggregate: z.enum(["sum", "avg", "max", "min", "count"]),
		windowSeconds: z.number().int().positive(),
		filter: z
			.object({
				toolName: z.union([GlobSchema, z.array(GlobSchema).min(1)]).optional(),
				toolTag: z
					.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
					.optional(),
			})
			.strict()
			.optional(),
		op: z.enum(["gt", "gte", "lt", "lte", "eq", "neq"]),
		value: z.number(),
		onMissing: RuleEffectKindSchema.optional(),
	})
	.strict();
export type MetricWindowCondition = z.infer<typeof MetricWindowConditionSchema>;
