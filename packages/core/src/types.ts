export type UserCategory = string;
export type ToolName = string;
export type ToolCategory = string;

export type ISO8601 = string; // date string
export type Id = string;

export type DecisionEffect = "allow" | "block";
export type DecisionCode =
	| "ALLOWED"
	| "BLOCKED_RULE"
	| "BLOCKED_SEQUENCE"
	| "BLOCKED_LIMIT"
	| "BLOCKED_CUSTOM"
	| "BLOCKED_UNCATEGORISED";

export interface Decision {
	effect: DecisionEffect;
	code: DecisionCode;
	reason?: string;
	ruleId?: string;
}

export interface Tool<
	TToolName extends ToolName = ToolName,
	TArgs = unknown,
	TResult = unknown,
> {
	name: TToolName;
	args: TArgs;
	result: TResult;
}

export interface ToolMeta<T extends Tool = Tool> {
	name: T["name"];
	categories: ToolCategory[];
}

export type ToolCall<T extends Tool = Tool> = T extends any
	? {
			tool: ToolMeta<T>;
			args: T["args"];
		}
	: never;

export type ToolResult<T extends Tool = Tool> = T extends any
	? {
			tool: ToolMeta<T>;
			args: T["args"];
			result: T["result"];
			error?: unknown;
		}
	: never;

export interface RunContext<T extends Tool = Tool> {
	runId: string;
	userCategory: UserCategory;
	stepIndex: number;
	history: ToolResult<T>[];
	counters: Record<string, number>;
	state: Map<string, unknown>;
	now: () => number;
}

export interface Predicate {
	id?: string;
	evaluate(
		ctx: RunContext<any>,
		call: ToolCall<any>,
	): boolean | Promise<boolean>;
}

export interface Rule {
	id: string;
	when: Predicate;
	effect: DecisionEffect;
	reason?: string;
}

export interface SequencePolicy {
	mustOccurBefore?: Array<{ before: ToolName; after: ToolName }>;
	maxCalls?: Record<ToolName, number>;
	executionLimitsMS?: Record<ToolName, number>;
	disallowConsecutive?: ToolName[];
}

export interface CustomCheck<T extends Tool = Tool> {
	id: string;
	before?: (
		ctx: RunContext<T>,
		call: ToolCall<T>,
	) => Decision | undefined | Promise<Decision | undefined>;
	after?: (ctx: RunContext<T>, result: ToolResult<T>) => void | Promise<void>;
}

export interface GovernanceConfig<T extends Tool = Tool> {
	tools: ToolMeta<T>[];
	rules?: Rule[];
	defaultUncategorised?: DecisionEffect;
	sequence?: SequencePolicy;
	checks?: CustomCheck<T>[];
	initialCounters?: Record<string, number>;
	mode?: "monitor" | "enforce";
	verbose?: boolean;
}
