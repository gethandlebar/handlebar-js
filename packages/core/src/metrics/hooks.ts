import type { RunContext } from "../types";

type AgentMetricHookPhase = "tool.before" | "tool.after";

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

type AgentMetricHookContext<P extends AgentMetricHookPhase> = AgentMetricHookContextMap[P];

type MetricHookResult = {
  value: number;
  unit?: string;
};

export type AgentMetricHook<P extends AgentMetricHookPhase = AgentMetricHookPhase> = {
  key: string;
  phase: P;

  when?: (ctx: AgentMetricHookContext<P>) => boolean;

  run: (ctx: AgentMetricHookContext<P>) => MetricHookResult | Promise<MetricHookResult>;

  timeoutMs?: number;
  blocking?: boolean;
};


export class AgentMetricHookRegistry {
  private store: { [P in AgentMetricHookPhase]: Map<string,AgentMetricHook<P>> } = {
    "tool.before": new Map(),
    "tool.after": new Map(),
  };

  registerHook<P extends AgentMetricHookPhase>(hook: AgentMetricHook<P>) {
    this.store[hook.phase].set(hook.key, hook);
  }

  unregisterHook(key: string, phase: AgentMetricHookPhase) {
    this.store[phase].delete(key);
  }

  async runPhase<P extends AgentMetricHookPhase>(
    phase: P,
    ctx: AgentMetricHookContext<P>,
    onMetric: (key: string, value: number, unit?: string) => void,
  ) {
    const hooks = this.store[phase];

    for (const [hookKey, hook] of hooks.entries()) {
      if (hook.when && !hook.when(ctx)) {
        continue;
      }

      const res = await Promise.resolve(hook.run(ctx));
      if (!res) {
        continue;
      }
      onMetric(hookKey, res.value, res.unit);
    }
  }
}
