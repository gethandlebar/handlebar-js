import type { AgentMetricHookPhase, AgentMetricHook, AgentMetricHookContext } from "./types";
import { validateMetricKey } from "./utils";

export class AgentMetricHookRegistry {
  private store: { [P in AgentMetricHookPhase]: Map<string,AgentMetricHook<P>> } = {
    "tool.before": new Map(),
    "tool.after": new Map(),
  };

  registerHook<P extends AgentMetricHookPhase>(hook: AgentMetricHook<P>) {
    if (!validateMetricKey(hook.key)) {
      throw new Error("Invalid metric key")
    }

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
