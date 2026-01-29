import { z } from "zod";

/**
 * Match on arbitrary tags assigned to the enduser.
 * "enduser" in this context means the users of a Handlebar user.
 * - has: existence AND truthiness of the tag. E.g. "has:tier" would be false if "tier=0", "tier=false", or no "tier" tag exists.
 * - hasValue: tag exists and has an exact given value
 */
export const EndUserTagConditionSchema = z.discriminatedUnion("op", [
	z
		.object({
			kind: z.literal("enduserTag"),
			op: z.literal("has"),
			tag: z.string().min(1),
		})
		.strict(),
	z
		.object({
			kind: z.literal("enduserTag"),
			op: z.literal("hasValue"),
			tag: z.string().min(1),
			value: z.string(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("enduserTag"),
			op: z.literal("hasValueAny"),
			tag: z.string().min(1),
			values: z.array(z.string()).min(1),
		})
		.strict(),
]);
export type EndUserTagCondition = z.infer<typeof EndUserTagConditionSchema>;
