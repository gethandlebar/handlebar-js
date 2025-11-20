import type { Rule } from "@handlebar/governance-schema";

export type Id = string;
export type ISO8601 = string; // date string

export type Tool<
  Name extends string = string,
  Args = unknown,
  Result = unknown
> = {
  name: Name;
  categories?: string[];
};

export type ToolMeta<T extends Tool = Tool> = T & {
  // any extra metadata you had here already
};


export type ToolCall<T extends Tool = Tool> = {
	tool: ToolMeta<T>;
	args: unknown;
};

export type ToolResult<T extends Tool = Tool> = {
	tool: ToolMeta<T>;
	args: unknown;
	result: unknown;
	error?: unknown;
};

export type GovernanceEffect = "allow" | "block";
export type GovernanceCode = "BLOCKED_UNCATEGORISED" | "BLOCKED_RULE" | "BLOCKED_CUSTOM" | "ALLOWED" | "NO_OP"

export type GovernanceDecision = {
  effect: GovernanceEffect;

  /** which rules matched */
  matchedRuleIds: string[];

  /** which actions were applied (allow, block, notify, etc.) */
  appliedActions: AppliedAction[];

  /** any human-readable summary for logs */
  reason?: string;

  /** engine-internal code for telemetry */
  code: GovernanceCode;
}

export type AppliedAction = {
  type: "allow" | "block" | "notify" | "log" | "hitl";
  ruleId: string;
};

export type CustomCheck<T extends Tool = Tool> = {
	before?: (ctx: RunContext<T>, call: ToolCall<T>) => Promise<GovernanceDecision | null> | GovernanceDecision | null;
	after?: (ctx: RunContext<T>, result: ToolResult<T>) => Promise<void> | void;
};

export type GovernanceConfig<T extends Tool = Tool> = {
	tools: ToolMeta<T>[];
	rules?: Rule[];
	defaultUncategorised?: GovernanceEffect;
	checks?: CustomCheck<T>[];
	mode?: "monitor" | "enforce";
	verbose?: boolean;
};

export type RunContext<T extends Tool = Tool> = {
	runId: string;
	userCategory: string;
	stepIndex: number;
	history: ToolResult<T>[];
	counters: Record<string, number>;
	state: Map<string, unknown>;
	now: () => number;
};
