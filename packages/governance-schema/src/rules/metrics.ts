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
		/**
		 * Scope of the metric aggregation:
		 *
		 * "run"        — aggregate from the start of the current agent run.
		 *                windowSeconds is ignored; the run's startedAt is used as
		 *                the window floor. Note: concurrent runs share the same
		 *                metric buckets, so counts may be slightly over-reported.
		 *                True per-run isolation is deferred to Phase 2.
		 *
		 * "agent"      — aggregate over windowSeconds, all end-users.
		 *
		 * "agent_user" — aggregate over windowSeconds, current end-user only.
		 */
		scope: z.enum(["run", "agent", "agent_user"]),
		metric: MetricRefSchema,
		aggregate: z.enum(["sum", "avg", "max", "min", "count"]),
		/**
		 * Duration of the look-back window in seconds.
		 * Required when scope is "agent" or "agent_user".
		 * When scope is "run" the run start time is used instead; this field is
		 * optional and ignored.
		 */
		windowSeconds: z.number().int().positive().optional(),
		filter: z
			.object({
				/**
				 * @deprecated Kept for schema compatibility; treated as a no-op by the evaluator.
				 */
				toolName: z.union([GlobSchema, z.array(GlobSchema).min(1)]).optional(),
				/**
				 * @deprecated Kept for schema compatibility; treated as a no-op by the evaluator.
				 */
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
