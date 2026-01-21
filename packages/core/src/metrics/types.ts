import type { RunContext } from "../types";

export type MetricInfo = { value: number; unit?: string };

export type AgentMetricHookPhase = "tool.before" | "tool.after";

export type AgentMetricInputToolBefore = {
  toolName: string;
  args: unknown;
  runContext: RunContext<any>;
}

export type AgentMetricInputToolAfter = {
  toolName: string;
  args: unknown,
	result: unknown,
	error?: unknown,
  runContext: RunContext<any>
}

type AgentMetricHookContextMap = {
  "tool.before": AgentMetricInputToolBefore;
  "tool.after": AgentMetricInputToolAfter;
}

export type AgentMetricHookContext<P extends AgentMetricHookPhase> = AgentMetricHookContextMap[P];

type MetricHookResult = {
  value: number;
  unit?: string;
};

export type AgentMetricHook<P extends AgentMetricHookPhase = AgentMetricHookPhase> = {
  key: string;
  phase: P;

  when?: (ctx: AgentMetricHookContext<P>) => boolean;

  run: (ctx: AgentMetricHookContext<P>) => MetricHookResult | Promise<MetricHookResult> | undefined | Promise<undefined>;

  timeoutMs?: number;
  blocking?: boolean;
};
