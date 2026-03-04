import { z } from "zod";
import { CustomFunctionConditionSchema } from "./custom";
import { EndUserTagConditionSchema } from "./enduser";
import { MetricWindowConditionSchema } from "./metrics";
import { SensitiveDataConditionSchema } from "./sensitive";
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
	SensitiveDataConditionSchema,
]);
type BaseRuleCondition = z.infer<typeof BaseRuleConditionSchema>;

// ---------------------------------------------------------------------------
// Recursive composition: and / or / not
//
// The TypeScript type must be declared explicitly because TypeScript cannot
// infer recursive types from z.infer alone.
// ---------------------------------------------------------------------------

export type RuleCondition =
	| BaseRuleCondition
	| { kind: "and"; all: RuleCondition[] }
	| { kind: "or"; any: RuleCondition[] }
	| { kind: "not"; not: RuleCondition };

const LazyRuleConditionSchema: z.ZodType<RuleCondition> = z.lazy(
	() => RuleConditionSchema,
);

const AndConditionSchema = z
	.object({
		kind: z.literal("and"),
		all: z.array(LazyRuleConditionSchema).min(1),
	})
	.strict();

const OrConditionSchema = z
	.object({
		kind: z.literal("or"),
		any: z.array(LazyRuleConditionSchema).min(1),
	})
	.strict();

const NotConditionSchema = z
	.object({ kind: z.literal("not"), not: LazyRuleConditionSchema })
	.strict();

export type AndCondition = { kind: "and"; all: RuleCondition[] };
export type OrCondition = { kind: "or"; any: RuleCondition[] };
export type NotCondition = { kind: "not"; not: RuleCondition };

export const RuleConditionSchema: z.ZodType<RuleCondition> = z.union([
	BaseRuleConditionSchema,
	AndConditionSchema,
	OrConditionSchema,
	NotConditionSchema,
]);
