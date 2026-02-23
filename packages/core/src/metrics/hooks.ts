import type {
	AgentMetricHook,
	AgentMetricHookContext,
	AgentMetricHookPhase,
	MetricInfo,
} from "./types";
import { validateMetricKey } from "./utils";

type HookStore = {
	[P in AgentMetricHookPhase]: Map<string, AgentMetricHook<P>>;
};

export class AgentMetricHookRegistry {
	private store: HookStore = {
		"tool.before": new Map(),
		"tool.after": new Map(),
	};

	registerHook<P extends AgentMetricHookPhase>(hook: AgentMetricHook<P>) {
		if (!validateMetricKey(hook.key)) {
			throw new Error("Invalid metric key");
		}

		(this.store[hook.phase] as Map<string, AgentMetricHook<P>>).set(
			hook.key,
			hook,
		);
	}

	unregisterHook(key: string, phase: AgentMetricHookPhase) {
		this.store[phase].delete(key);
	}

	async runPhase<P extends AgentMetricHookPhase>(
		phase: P,
		ctx: AgentMetricHookContext<P>,
		onMetric: (key: string, value: number, unit?: string) => void,
	) {
		const hooksForPhase = this.store[phase] as Map<string, AgentMetricHook<P>>;

		for (const [hookKey, hook] of hooksForPhase.entries()) {
			if (hook.when && !hook.when(ctx)) {
				continue;
			}

			let runPromise: Promise<MetricInfo | void> = Promise.resolve(
				hook.run(ctx),
			);

			if (hook.timeoutMs !== undefined) {
				runPromise = Promise.race([
					runPromise,
					new Promise<void>((resolve) => setTimeout(resolve, hook.timeoutMs)),
				]);
			}

			const emit = (res: MetricInfo | void) => {
				if (res) {
					onMetric(hookKey, res.value, res.unit);
				}
			};

			if (hook.blocking === false) {
				runPromise.then(emit).catch(() => {});
			} else {
				emit(await runPromise);
			}
		}
	}
}
