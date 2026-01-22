import type { AndCondition, CustomFunctionCondition, EndUserTagCondition, ExecutionTimeCondition, MaxCallsCondition, NotCondition, OrCondition, SequenceCondition, ToolNameCondition, ToolTagCondition } from "../condition.types";
import type { MetricWindowCondition } from "./metrics";
import type { RequireSubjectCondition, SignalCondition } from "./signals";
import type { TimeGateCondition } from "./time";

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
