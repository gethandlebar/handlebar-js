import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Rule } from "@handlebar/governance-schema";
import { withRunContext } from "../src/audit/context";
import { createAuditBus } from "../src/audit/bus";
import { Telemetry } from "../src/audit/telemetry";
import { GovernanceEngine, HANDLEBAR_ACTION_STATUS } from "../src/engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(
	opts: Pick<Rule, "condition"> & Partial<Omit<Rule, "condition">>,
): Rule {
	return {
		id: "r1",
		policyId: "p1",
		enabled: true,
		priority: 0,
		name: "Test",
		selector: { phase: "tool.before", tool: { name: "test_tool" } },
		effect: { type: "block" },
		...opts,
	};
}

function makeEngine(rules: Rule[] = [], extraTools: string[] = []) {
	const toolNames = ["test_tool", "other_tool", ...extraTools];
	return new GovernanceEngine({
		tools: toolNames.map((name) => ({ name })),
		rules,
	});
}

// ---------------------------------------------------------------------------
// createRunContext
// ---------------------------------------------------------------------------

describe("createRunContext", () => {
	it("returns the correct initial shape", () => {
		const engine = makeEngine();
		const ctx = engine.createRunContext("run-1");

		expect(ctx.runId).toBe("run-1");
		expect(ctx.stepIndex).toBe(0);
		expect(ctx.history).toEqual([]);
		expect(ctx.state).toBeInstanceOf(Map);
		expect(ctx.state.size).toBe(0);
		expect(typeof ctx.now).toBe("function");
	});

	it("merges initialCounters", () => {
		const engine = makeEngine();
		const ctx = engine.createRunContext("run-1", {
			initialCounters: { my_counter: 5 },
		});
		expect(ctx.counters.my_counter).toBe(5);
	});

	it("passes through enduser config", () => {
		const engine = makeEngine();
		const enduser = { externalId: "u1", metadata: { role: "admin" } };
		const ctx = engine.createRunContext("run-1", { enduser });
		expect(ctx.enduser).toEqual(enduser);
	});

	it("two contexts from the same engine are independent", () => {
		const engine = makeEngine();
		const ctx1 = engine.createRunContext("run-1");
		const ctx2 = engine.createRunContext("run-2");
		ctx1.state.set("k", "v");
		expect(ctx2.state.get("k")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// afterTool – context mutation
// ---------------------------------------------------------------------------

describe("afterTool – context mutation", () => {
	it("increments stepIndex and appends to history", async () => {
		const engine = makeEngine();
		const ctx = engine.createRunContext("run-1");

		await engine.afterTool(ctx, "test_tool", 10, {}, "result");

		expect(ctx.stepIndex).toBe(1);
		expect(ctx.history).toHaveLength(1);
		expect(ctx.history[0].tool.name).toBe("test_tool");
		expect(ctx.history[0].result).toBe("result");
	});

	it("accumulates executionTimeMS into the total-duration counter", async () => {
		const engine = makeEngine();
		const ctx = engine.createRunContext("run-1");

		await engine.afterTool(ctx, "test_tool", 50, {}, "r1");
		await engine.afterTool(ctx, "test_tool", 30, {}, "r2");

		// The private constant __hb_totalDurationMs accumulates
		const totalKey = Object.keys(ctx.counters).find((k) =>
			k.startsWith("__hb"),
		);
		expect(totalKey).toBeDefined();
		expect(ctx.counters[totalKey!]).toBe(80);
	});

	it("state Map persists across lifecycle calls", async () => {
		const engine = makeEngine();
		const ctx = engine.createRunContext("run-1");
		ctx.state.set("session", "active");

		await engine.afterTool(ctx, "test_tool", 10, {}, "result");

		expect(ctx.state.get("session")).toBe("active");
	});

	it("stores error on the history entry", async () => {
		const engine = makeEngine();
		const ctx = engine.createRunContext("run-1");
		const err = new Error("boom");

		await engine.afterTool(ctx, "test_tool", 5, {}, undefined, err);

		expect(ctx.history[0].error).toBe(err);
	});
});

// ---------------------------------------------------------------------------
// beforeTool – decision lifecycle
// ---------------------------------------------------------------------------

describe("beforeTool – decisions", () => {
	it("no rules → allow", async () => {
		const engine = makeEngine();
		const ctx = engine.createRunContext("run-1");

		const d = await engine.beforeTool(ctx, "test_tool", {});

		expect(d.effect).toBe("allow");
		expect(d.code).toBe("ALLOWED");
		expect(d.matchedRuleIds).toHaveLength(0);
	});

	it("matching block rule → block", async () => {
		const rule = makeRule({
			condition: { kind: "toolName", op: "eq", value: "test_tool" },
		});
		const engine = makeEngine([rule]);
		const ctx = engine.createRunContext("run-1");

		const d = await engine.beforeTool(ctx, "test_tool", {});

		expect(d.effect).toBe("block");
		expect(d.code).toBe("BLOCKED_RULE");
		expect(d.matchedRuleIds).toContain("r1");
	});

	it("matching allow rule → allow", async () => {
		const rule = makeRule({
			condition: { kind: "toolName", op: "eq", value: "test_tool" },
			effect: { type: "allow" },
		});
		const engine = makeEngine([rule]);
		const ctx = engine.createRunContext("run-1");

		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("matching hitl rule → hitl when no API configured", async () => {
		const rule = makeRule({
			condition: { kind: "toolName", op: "eq", value: "test_tool" },
			effect: { type: "hitl" },
		});
		const engine = makeEngine([rule]);
		const ctx = engine.createRunContext("run-1");

		const d = await engine.beforeTool(ctx, "test_tool", {});

		// queryHitl returns null (no API) → hitl effect is kept as-is
		expect(d.effect).toBe("hitl");
		expect(d.code).toBe("BLOCKED_HITL_REQUESTED");
	});

	it("block beats hitl (effectRank: block=3 > hitl=2)", async () => {
		const rules: Rule[] = [
			makeRule({
				id: "r-hitl",
				condition: { kind: "toolName", op: "eq", value: "test_tool" },
				effect: { type: "hitl" },
			}),
			makeRule({
				id: "r-block",
				condition: { kind: "toolName", op: "eq", value: "test_tool" },
				effect: { type: "block" },
			}),
		];
		const engine = makeEngine(rules);
		const ctx = engine.createRunContext("run-1");

		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("before-phase rule does not fire in after-phase", async () => {
		const rule = makeRule({
			selector: { phase: "tool.before", tool: { name: "test_tool" } },
			condition: { kind: "toolName", op: "eq", value: "test_tool" },
		});
		const engine = makeEngine([rule]);
		const ctx = engine.createRunContext("run-1");

		// afterTool runs an internal decide() for "tool.after" phase; rule must not match
		await expect(
			engine.afterTool(ctx, "test_tool", 10, {}, "ok"),
		).resolves.toBeUndefined();
	});

	it("glob selector on rule.selector.tool.name matches tool", async () => {
		const rule: Rule = {
			id: "r1",
			policyId: "p1",
			enabled: true,
			priority: 0,
			name: "glob",
			selector: { phase: "tool.before", tool: { name: "send_*" } },
			condition: { kind: "toolName", op: "glob", value: "send_*" },
			effect: { type: "block" },
		};
		const engine = new GovernanceEngine({
			tools: [{ name: "send_email" }],
			rules: [rule],
		});
		const ctx = engine.createRunContext("run-1");

		const d = await engine.beforeTool(ctx, "send_email", {});
		expect(d.effect).toBe("block");
	});

	it("disabled rule is ignored", async () => {
		const rule = makeRule({
			enabled: false,
			condition: { kind: "toolName", op: "eq", value: "test_tool" },
		});
		const engine = makeEngine([rule]);
		const ctx = engine.createRunContext("run-1");

		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("non-matching rule (different tool name) → allow", async () => {
		const rule = makeRule({
			condition: { kind: "toolName", op: "eq", value: "other_tool" },
		});
		const engine = makeEngine([rule]);
		const ctx = engine.createRunContext("run-1");

		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("non-plain-object args (null, string, array) do not throw", async () => {
		const engine = makeEngine();
		const ctx = engine.createRunContext("run-1");

		await expect(
			engine.beforeTool(ctx, "test_tool", null),
		).resolves.toBeDefined();
		await expect(
			engine.beforeTool(ctx, "test_tool", "a string"),
		).resolves.toBeDefined();
		await expect(
			engine.beforeTool(ctx, "test_tool", [1, 2, 3]),
		).resolves.toBeDefined();
	});

	it("unknown tool name throws", async () => {
		const engine = makeEngine();
		const ctx = engine.createRunContext("run-1");

		await expect(
			engine.beforeTool(ctx, "not_registered", {}),
		).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// decisionAction
// ---------------------------------------------------------------------------

describe("decisionAction", () => {
	const makeDecision = (effect: "allow" | "block" | "hitl") =>
		({
			effect,
			code:
				effect === "block"
					? "BLOCKED_RULE"
					: effect === "hitl"
						? "BLOCKED_HITL_REQUESTED"
						: "ALLOWED",
			matchedRuleIds: [],
			appliedActions: [],
			signals: [],
		}) as any;

	it("allow → null", () => {
		const engine = makeEngine();
		expect(engine.decisionAction(makeDecision("allow"))).toBeNull();
	});

	it("block → TOOL_BLOCK_CODE action", () => {
		const engine = makeEngine();
		const action = engine.decisionAction(makeDecision("block"));
		expect(action?.code).toBe(HANDLEBAR_ACTION_STATUS.TOOL_BLOCK_CODE);
	});

	it("hitl → EXIT_RUN_CODE action", () => {
		const engine = makeEngine();
		const action = engine.decisionAction(makeDecision("hitl"));
		expect(action?.code).toBe(HANDLEBAR_ACTION_STATUS.EXIT_RUN_CODE);
	});

	it("monitor mode returns null even for block", () => {
		const engine = new GovernanceEngine({
			tools: [{ name: "test_tool" }],
			rules: [],
			mode: "monitor",
		});
		expect(engine.decisionAction(makeDecision("block"))).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Audit event emission
// Tests require: (1) agentId set via initAgentRules (mocked fetch)
//                (2) called inside withRunContext (emit.ts early-returns otherwise)
// ---------------------------------------------------------------------------

describe("audit event emission", () => {
	const realFetch = globalThis.fetch;
	let captured: Array<{ agentId: string; event: any }> = [];

	beforeEach(async () => {
		captured = [];

		// Inject a capture sink into the Telemetry singleton
		const bus = createAuditBus();
		bus.use({
			write(agentId, event) {
				captured.push({ agentId, event });
			},
		});
		(Telemetry as any)._bus = bus;
		(Telemetry as any)._inited = true;

		// Minimal fetch mock so initAgentRules can set agentId
		globalThis.fetch = mock(async (url: string) => {
			if (url.includes("/v1/agents") && !url.includes("rules")) {
				return new Response(JSON.stringify({ agentId: "agent-1" }), {
					status: 200,
				});
			}
			if (url.includes("/v1/rules")) {
				return new Response(JSON.stringify({ rules: [] }), { status: 200 });
			}
			return new Response(JSON.stringify(null), { status: 200 });
		}) as any;

		process.env.HANDLEBAR_API_KEY = "test-key";
	});

	afterEach(async () => {
		globalThis.fetch = realFetch;
		delete process.env.HANDLEBAR_API_KEY;
		await (Telemetry as any)._bus?.shutdown();
		(Telemetry as any)._bus = null;
		(Telemetry as any)._inited = false;
	});

	it("beforeTool emits tool.decision event", async () => {
		const engine = makeEngine();
		await engine.initAgentRules({ slug: "test" }, []);
		const ctx = engine.createRunContext("run-1");

		await withRunContext({ runId: "run-1" }, () =>
			engine.beforeTool(ctx, "test_tool", {}),
		);

		const decision = captured.find((c) => c.event.kind === "tool.decision");
		expect(decision).toBeDefined();
		expect(decision?.agentId).toBe("agent-1");
		expect(decision?.event.data.tool.name).toBe("test_tool");
	});

	it("afterTool emits tool.result event", async () => {
		const engine = makeEngine();
		await engine.initAgentRules({ slug: "test" }, []);
		const ctx = engine.createRunContext("run-1");

		await withRunContext({ runId: "run-1" }, () =>
			engine.afterTool(ctx, "test_tool", 42, {}, "output"),
		);

		const result = captured.find((c) => c.event.kind === "tool.result");
		expect(result).toBeDefined();
		expect(result?.event.data.durationMs).toBe(42);
	});

	it("events carry the runId from the run context", async () => {
		const engine = makeEngine();
		await engine.initAgentRules({ slug: "test" }, []);
		const ctx = engine.createRunContext("run-abc");

		await withRunContext({ runId: "run-abc" }, () =>
			engine.beforeTool(ctx, "test_tool", {}),
		);

		const decision = captured.find((c) => c.event.kind === "tool.decision");
		expect(decision?.event.runId).toBe("run-abc");
	});

	it("no agentId → no events emitted", async () => {
		// Do NOT call initAgentRules; agentId stays null
		const engine = makeEngine();
		const ctx = engine.createRunContext("run-1");

		await withRunContext({ runId: "run-1" }, () =>
			engine.beforeTool(ctx, "test_tool", {}),
		);

		expect(captured).toHaveLength(0);
	});
});
