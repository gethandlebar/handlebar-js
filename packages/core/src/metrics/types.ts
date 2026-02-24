import type { Run } from "../run";

export type MetricInfo = { value: number; unit?: string };

export type Awaitable<T> = T | Promise<T>;

export type AgentMetricHookPhase = "tool.before" | "tool.after";

export type AgentMetricInputToolBefore = {
	toolName: string;
	args: unknown;
	run: Run;
};

export type AgentMetricInputToolAfter = {
	toolName: string;
	args: unknown;
	result?: unknown; // allow absence on error
	error?: unknown;
	run: Run;
};

export type AgentMetricHookContextMap = {
	"tool.before": AgentMetricInputToolBefore;
	"tool.after": AgentMetricInputToolAfter;
};

export type AgentMetricHookContext<P extends AgentMetricHookPhase> =
	AgentMetricHookContextMap[P];

export type AgentMetricHook<
	P extends AgentMetricHookPhase = AgentMetricHookPhase,
> = {
	key: string;
	phase: P;

	when?: (ctx: AgentMetricHookContext<P>) => boolean;

	run: (ctx: AgentMetricHookContext<P>) => Awaitable<MetricInfo | void>;

	timeoutMs?: number;
	blocking?: boolean;
};
