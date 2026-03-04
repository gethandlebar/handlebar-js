import { z } from "zod";

const DaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Day = z.infer<typeof DaySchema>;

const TimeHHMMSchema = z
	.string()
	// 24h "HH:MM"
	.regex(
		/^([01]\d|2[0-3]):[0-5]\d$/,
		'Expected time in "HH:MM" 24-hour format',
	);

/**
 * Timezone source for TimeGate evaluation.
 *
 * "enduserTag" - read the timezone from an end-user tag at runtime; falls back
 *               to the organisation timezone when the tag is absent and
 *               fallback: "org" is set.
 *
 * "static"     - use a fixed IANA timezone string for all evaluations,
 *               regardless of end-user context.
 */
const TimezoneSchema = z.discriminatedUnion("source", [
	z
		.object({
			source: z.literal("enduserTag"),
			tag: z.string().min(1),
			/** Fall back to the organisation's configured timezone when the tag is absent. */
			fallback: z.literal("org").optional(),
		})
		.strict(),
	z
		.object({
			source: z.literal("static"),
			/** IANA timezone identifier, e.g. "UTC" or "Europe/London". */
			tz: z.string().min(1),
		})
		.strict(),
]);

export const TimeGateConditionSchema = z
	.object({
		kind: z.literal("timeGate"),
		timezone: TimezoneSchema,
		windows: z
			.array(
				z
					.object({
						days: z.array(DaySchema).min(1),
						start: TimeHHMMSchema,
						end: TimeHHMMSchema,
					})
					.strict(),
			)
			.min(1),
	})
	.strict();
export type TimeGateCondition = z.infer<typeof TimeGateConditionSchema>;

const ExecutionTimeScopeSchema = z.enum(["tool", "total"]);
export type ExecutionTimeScope = z.infer<typeof ExecutionTimeScopeSchema>;

export const ExecutionTimeConditionSchema = z
	.object({
		kind: z.literal("executionTime"),
		scope: ExecutionTimeScopeSchema,
		op: z.enum(["gt", "gte", "lt", "lte", "eq", "neq"]),
		ms: z.number().int().nonnegative(),
	})
	.strict();
export type ExecutionTimeCondition = z.infer<
	typeof ExecutionTimeConditionSchema
>;
