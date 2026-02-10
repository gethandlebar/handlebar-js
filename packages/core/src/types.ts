import type {
	EndUserConfig,
	EndUserGroupConfig,
	GovernanceDecision,
	GovernanceEffect,
	Rule,
} from "@handlebar/governance-schema";
import type { HandlebarRunOpts } from "./runs";

export type Id = string;
export type ISO8601 = string; // date string

export type Tool<
	Name extends string = string,
	_Args = unknown,
	_Result = unknown,
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

export type CustomCheck<T extends Tool = Tool> = {
	before?: (
		ctx: RunContext<T>,
		call: ToolCall<T>,
	) => Promise<GovernanceDecision | null> | GovernanceDecision | null;
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

/**
 * TODO: deduplicate with `RunCtx`.
 */
export type RunContext<T extends Tool = Tool> = {
	runId: string;
	stepIndex: number;
	history: ToolResult<T>[];
	counters: Record<string, number>;
	state: Map<string, unknown>;
	now: () => number;
	model?: { name: string; provider?: string };
	enduser?: EndUserConfig & { group?: EndUserGroupConfig };
} & HandlebarRunOpts;
