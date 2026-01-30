import { z } from "zod";
import { CustomFunctionConditionSchema } from "./custom";
import { EndUserTagConditionSchema } from "./enduser";
import { MetricWindowConditionSchema } from "./metrics";
import {
	RequireSubjectConditionSchema,
	SignalConditionSchema,
} from "./signals";
import { ExecutionTimeConditionSchema, TimeGateConditionSchema } from "./time";
import {
	MaxCallsConditionSchema,
	SequenceConditionSchema,
	ToolArgConditionSchema,
	ToolNameConditionSchema,
	ToolTagConditionSchema,
} from "./tools";

const BaseRuleConditionSchema = z.union([
	ToolNameConditionSchema,
  ToolTagConditionSchema,
	ToolArgConditionSchema,
	EndUserTagConditionSchema,
	ExecutionTimeConditionSchema,
	SequenceConditionSchema,
	MaxCallsConditionSchema,
	CustomFunctionConditionSchema,
	MetricWindowConditionSchema,
	TimeGateConditionSchema,
	RequireSubjectConditionSchema,
	SignalConditionSchema,
]);

const AndConditionSchema = z
	.object({
		kind: z.literal("and"),
		all: z.array(BaseRuleConditionSchema).min(1),
	})
	.strict();
const OrConditionSchema = z
	.object({
		kind: z.literal("or"),
		any: z.array(BaseRuleConditionSchema).min(1),
	})
	.strict();
const NotConditionSchema = z
	.object({ kind: z.literal("not"), not: BaseRuleConditionSchema })
	.strict();

export type AndCondition = z.infer<typeof AndConditionSchema>;
export type OrCondition = z.infer<typeof OrConditionSchema>;
export type NotCondition = z.infer<typeof NotConditionSchema>;

export const RuleConditionSchema = z.union([
	BaseRuleConditionSchema,
	AndConditionSchema,
	OrConditionSchema,
	NotConditionSchema,
]);
export type RuleCondition = z.infer<typeof RuleConditionSchema>;
