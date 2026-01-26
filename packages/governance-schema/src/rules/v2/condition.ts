import type { CustomFunctionCondition } from "./custom";
import type { MetricWindowCondition } from "./metrics";
import type { EndUserTagCondition } from "./enduser";
import type { RequireSubjectCondition, SignalCondition } from "./signals";
import type { TimeGateCondition, ExecutionTimeCondition } from "./time";
import type { MaxCallsCondition, SequenceCondition, ToolNameCondition, ToolTagCondition } from "./tools";

export type AndCondition = { kind: "and"; all: RuleConditionV2[] };
export type OrCondition = { kind: "or"; any: RuleConditionV2[] };
export type NotCondition = { kind: "not"; not: RuleConditionV2 };


export type RuleConditionV2 =
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
