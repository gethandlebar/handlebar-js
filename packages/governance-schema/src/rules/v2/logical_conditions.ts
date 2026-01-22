import type { RuleConditionV2 } from "./condition";

export type AndCondition = { kind: "and"; all: RuleConditionV2[] };
export type OrCondition = { kind: "or"; any: RuleConditionV2[] };
export type NotCondition = { kind: "not"; not: RuleConditionV2 };
