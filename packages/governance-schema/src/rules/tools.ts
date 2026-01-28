import type { Glob } from "./common";

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
