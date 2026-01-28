import type { CustomFunctionCondition } from "./custom";
import type { MetricWindowCondition } from "./metrics";
import type { EndUserTagCondition } from "./enduser";
import type { RequireSubjectCondition, SignalCondition } from "./signals";
import type { TimeGateCondition, ExecutionTimeCondition } from "./time";
import type {
	MaxCallsCondition,
	SequenceCondition,
	ToolNameCondition,
	ToolTagCondition,
} from "./tools";

export type AndCondition = { kind: "and"; all: RuleCondition[] };
export type OrCondition = { kind: "or"; any: RuleCondition[] };
export type NotCondition = { kind: "not"; not: RuleCondition };

export type RuleCondition =
	| ToolNameCondition
	| ToolTagCondition
	| EndUserTagCondition
	| ExecutionTimeCondition
	| SequenceCondition
	| MaxCallsCondition
	| CustomFunctionCondition
	| MetricWindowCondition
	| TimeGateCondition
	| RequireSubjectCondition
	| SignalCondition
	| AndCondition
	| OrCondition
	| NotCondition;
