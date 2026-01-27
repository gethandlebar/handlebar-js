export type TimeGateCondition = {
	kind: "timeGate";
	timezone: // | { source: "org" }
	{ source: "endUserTag"; tag: string; fallback?: "org" };
	// TODO: specify a timezone in condition.
	windows: Array<{
		days: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
		start: string;
		end: string;
	}>;
};

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
