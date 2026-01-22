import type { CustomFunctionCondition, EndUserTagCondition, ExecutionTimeCondition, MaxCallsCondition, SequenceCondition, ToolNameCondition, ToolTagCondition } from "../condition.types";
import type { AndCondition, NotCondition, OrCondition } from "./logical_conditions";
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
