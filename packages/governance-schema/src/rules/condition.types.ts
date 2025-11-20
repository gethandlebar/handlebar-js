/**
 * Strongly-typed rule condition/action schema for rule enforcement.
 *
 * Notes:
 * - Conditions are composable via AND / OR / NOT
 * - Actions are currently limited to "block" and "allow" but are modeled for future extension
 */

/**
 * Case-insensitive glob pattern (e.g. "search-*", "*-prod", "exact-name")
 */
export type Glob = string;

/**
 * JSON-safe value for condition parameters and custom function args.
 */
export type JSONValue =
	| string
	| number
	| boolean
	| null
	| { [k: string]: JSONValue }
	| JSONValue[];

// ---------- Primitive/leaf conditions ---------- //

/**
 * Match on a tool's name.
 * - glob comparator supports wildcard matching
 * - in comparator permits list membership check
 */
export type ToolNameCondition =
	| {
			kind: "toolName";
			op: "eq" | "neq" | "contains" | "startsWith" | "endsWith" | "glob";
			value: string | Glob;
	  }
	| {
			kind: "toolName";
			op: "in";
			value: (string | Glob)[];
	  };

/**
 * Match on tool tags present on the tool.
 * - has: single tag must be present
 * - anyOf: at least one tag present
 * - allOf: every provided tag must be present
 */
export type ToolTagCondition =
	| { kind: "toolTag"; op: "has"; tag: string }
	| { kind: "toolTag"; op: "anyOf"; tags: string[] }
	| { kind: "toolTag"; op: "allOf"; tags: string[] };

/**
 * Scope for execution time measurement.
 * - "tool": the single tool call duration
 * - "total": end-to-end agent run (from start to now)
 */
export type ExecutionTimeScope = "tool" | "total";

/**
 * Match against execution time thresholds (milliseconds).
 */
export type ExecutionTimeCondition = {
	kind: "executionTime";
	scope: ExecutionTimeScope;
	op: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
	ms: number;
};

/**
 * Enforce sequencing constraints within the current run history.
 * - mustHaveCalled: all listed tool name patterns must have been called earlier
 * - mustNotHaveCalled: none of the listed patterns may have been called earlier
 */
export type SequenceCondition = {
	kind: "sequence";
	mustHaveCalled?: Glob[];
	mustNotHaveCalled?: Glob[];
};

/**
 * Select tools for counting within a run.
 * - by toolName: count calls whose name matches any provided glob patterns
 * - by toolTag: count calls whose tool includes any of the provided tags
 */
export type MaxCallsSelector =
	| { by: "toolName"; patterns: Glob[] }
	| { by: "toolTag"; tags: string[] };

/**
 * Assert a maximum number of calls within a run for the selected tools (inclusive).
 */
export type MaxCallsCondition = {
	kind: "maxCalls";
	selector: MaxCallsSelector;
	max: number;
};

/**
 * Delegate condition evaluation to a user-defined function.
 * - `name` is resolved by the host SDK/application
 * - `args` is an opaque, JSON-serializable payload consumed by user code
 */
export type CustomFunctionCondition = {
	kind: "custom";
	name: string;
	args?: JSONValue;
};

export type AndCondition = { kind: "and"; all: RuleCondition[] };
export type OrCondition = { kind: "or"; any: RuleCondition[] };
export type NotCondition = { kind: "not"; not: RuleCondition };

/**
 * The full condition algebra supported by the rule engine.
 */
export type RuleCondition =
	| ToolNameCondition
	| ToolTagCondition
	| ExecutionTimeCondition
	| SequenceCondition
	| MaxCallsCondition
	| CustomFunctionCondition
	| AndCondition
	| OrCondition
	| NotCondition;
