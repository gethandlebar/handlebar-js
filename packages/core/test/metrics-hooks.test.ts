import { describe, expect, it } from "bun:test";
import { AgentMetricHookRegistry } from "../src/metrics/hooks";

function makeBeforeCtx() {
	return {
		toolName: "test_tool",
		args: { count: 3 },
		runContext: {
			runId: "run-1",
			stepIndex: 0,
			history: [],
			counters: {},
			state: new Map(),
			now: () => Date.now(),
		} as any,
	};
}

function makeAfterCtx() {
	return { ...makeBeforeCtx(), result: { rows: [1, 2, 3] }, error: undefined };
}

// ---------------------------------------------------------------------------
// registerHook
// ---------------------------------------------------------------------------

describe("AgentMetricHookRegistry.registerHook", () => {
	it("invalid key throws", () => {
		const reg = new AgentMetricHookRegistry();
		expect(() =>
			reg.registerHook({
				key: "bad-key!",
				phase: "tool.before",
				run: () => {},
			}),
		).toThrow();
	});

	it("valid key is accepted", () => {
		const reg = new AgentMetricHookRegistry();
		expect(() =>
			reg.registerHook({
				key: "valid_key",
				phase: "tool.before",
				run: () => {},
			}),
		).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// runPhase
// ---------------------------------------------------------------------------

describe("AgentMetricHookRegistry.runPhase", () => {
	it("calls hook and passes metric via onMetric callback", async () => {
		const reg = new AgentMetricHookRegistry();
		reg.registerHook({
			key: "my_metric",
			phase: "tool.before",
			run: () => ({ value: 42, unit: "count" }),
		});

		const collected: Array<{ key: string; value: number; unit?: string }> = [];
		await reg.runPhase("tool.before", makeBeforeCtx(), (k, v, u) =>
			collected.push({ key: k, value: v, unit: u }),
		);

		expect(collected).toHaveLength(1);
		expect(collected[0]).toEqual({
			key: "my_metric",
			value: 42,
			unit: "count",
		});
	});

	it("async hook is awaited", async () => {
		const reg = new AgentMetricHookRegistry();
		reg.registerHook({
			key: "async_metric",
			phase: "tool.before",
			run: async () => ({ value: 7 }),
		});

		const collected: number[] = [];
		await reg.runPhase("tool.before", makeBeforeCtx(), (_, v) =>
			collected.push(v),
		);

		expect(collected).toEqual([7]);
	});

	it("hook with when guard false → not called", async () => {
		const reg = new AgentMetricHookRegistry();
		reg.registerHook({
			key: "guarded",
			phase: "tool.before",
			when: (ctx) => ctx.toolName === "other_tool", // false for test_tool
			run: () => ({ value: 99 }),
		});

		const collected: number[] = [];
		await reg.runPhase("tool.before", makeBeforeCtx(), (_, v) =>
			collected.push(v),
		);

		expect(collected).toHaveLength(0);
	});

	it("hook with when guard true → called", async () => {
		const reg = new AgentMetricHookRegistry();
		reg.registerHook({
			key: "guarded2",
			phase: "tool.before",
			when: (ctx) => ctx.toolName === "test_tool",
			run: () => ({ value: 5 }),
		});

		const collected: number[] = [];
		await reg.runPhase("tool.before", makeBeforeCtx(), (_, v) =>
			collected.push(v),
		);

		expect(collected).toEqual([5]);
	});

	it("hook returning undefined/void is skipped (no callback)", async () => {
		const reg = new AgentMetricHookRegistry();
		reg.registerHook({
			key: "noop_hook",
			phase: "tool.before",
			run: () => {},
		});

		const collected: number[] = [];
		await reg.runPhase("tool.before", makeBeforeCtx(), (_, v) =>
			collected.push(v),
		);

		expect(collected).toHaveLength(0);
	});

	it("tool.after phase hooks do not fire for tool.before runPhase", async () => {
		const reg = new AgentMetricHookRegistry();
		reg.registerHook({
			key: "after_hook",
			phase: "tool.after",
			run: () => ({ value: 1 }),
		});

		const collected: number[] = [];
		await reg.runPhase("tool.before", makeBeforeCtx(), (_, v) =>
			collected.push(v),
		);

		expect(collected).toHaveLength(0);
	});

	it("after phase hook fires correctly", async () => {
		const reg = new AgentMetricHookRegistry();
		reg.registerHook({
			key: "result_size",
			phase: "tool.after",
			run: (ctx) => ({ value: (ctx as any).result?.rows?.length ?? 0 }),
		});

		const collected: number[] = [];
		await reg.runPhase("tool.after", makeAfterCtx(), (_, v) =>
			collected.push(v),
		);

		expect(collected).toEqual([3]);
	});

	it("unregisterHook removes hook from phase", async () => {
		const reg = new AgentMetricHookRegistry();
		reg.registerHook({
			key: "removable",
			phase: "tool.before",
			run: () => ({ value: 1 }),
		});
		reg.unregisterHook("removable", "tool.before");

		const collected: number[] = [];
		await reg.runPhase("tool.before", makeBeforeCtx(), (_, v) =>
			collected.push(v),
		);

		expect(collected).toHaveLength(0);
	});

	it("hook with timeoutMs exceeded → result discarded", async () => {
		const reg = new AgentMetricHookRegistry();
		reg.registerHook({
			key: "slow_hook",
			phase: "tool.before",
			timeoutMs: 10,
			run: async () => {
				await new Promise((resolve) => setTimeout(resolve, 100));
				return { value: 99 };
			},
		});

		const collected: number[] = [];
		await reg.runPhase("tool.before", makeBeforeCtx(), (_, v) =>
			collected.push(v),
		);
		expect(collected).toHaveLength(0);
	});

	it("hook with timeoutMs not exceeded → result captured", async () => {
		const reg = new AgentMetricHookRegistry();
		reg.registerHook({
			key: "fast_hook",
			phase: "tool.before",
			timeoutMs: 500,
			run: async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				return { value: 5 };
			},
		});

		const collected: number[] = [];
		await reg.runPhase("tool.before", makeBeforeCtx(), (_, v) =>
			collected.push(v),
		);
		expect(collected).toEqual([5]);
	});

	it("non-blocking hook (blocking: false) does not delay runPhase", async () => {
		const reg = new AgentMetricHookRegistry();
		let hookCompleted = false;
		reg.registerHook({
			key: "nb_hook",
			phase: "tool.before",
			blocking: false,
			run: async () => {
				await new Promise((resolve) => setTimeout(resolve, 50));
				hookCompleted = true;
				return { value: 1 };
			},
		});

		const start = Date.now();
		await reg.runPhase("tool.before", makeBeforeCtx(), () => {});
		const elapsed = Date.now() - start;

		expect(elapsed).toBeLessThan(30);
		expect(hookCompleted).toBe(false);

		// Allow background hook to complete
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(hookCompleted).toBe(true);
	});

	it("blocking: true awaits hook before runPhase returns", async () => {
		const reg = new AgentMetricHookRegistry();
		let hookCompleted = false;
		reg.registerHook({
			key: "blocking_hook",
			phase: "tool.before",
			blocking: true,
			run: async () => {
				await new Promise((resolve) => setTimeout(resolve, 20));
				hookCompleted = true;
				return { value: 1 };
			},
		});

		await reg.runPhase("tool.before", makeBeforeCtx(), () => {});
		expect(hookCompleted).toBe(true);
	});

	it("multiple hooks in same phase all fire", async () => {
		const reg = new AgentMetricHookRegistry();
		reg.registerHook({
			key: "m1",
			phase: "tool.before",
			run: () => ({ value: 1 }),
		});
		reg.registerHook({
			key: "m2",
			phase: "tool.before",
			run: () => ({ value: 2 }),
		});

		const collected: string[] = [];
		await reg.runPhase("tool.before", makeBeforeCtx(), (k) =>
			collected.push(k),
		);

		expect(collected).toContain("m1");
		expect(collected).toContain("m2");
	});
});
