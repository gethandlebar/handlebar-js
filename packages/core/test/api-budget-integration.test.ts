import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Rule } from "@handlebar/governance-schema";
import { GovernanceEngine } from "../src/engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

const AGENT_ID = "agent-integration";

const metricRule: Rule = {
	id: "bytes-budget",
	policyId: "p1",
	enabled: true,
	priority: 0,
	name: "Bytes Budget",
	selector: { phase: "tool.before", tool: { name: "test_tool" } },
	condition: {
		kind: "metricWindow",
		scope: "agent",
		metric: { kind: "inbuilt", key: "bytes_in" },
		aggregate: "sum",
		windowSeconds: 3600,
		op: "gt",
		value: 10000,
	},
	effect: { type: "block" },
};

// Builds a mock fetch that serves the integration scenario.
// budgetDecision controls what the budget API returns.
function buildFetch(budgetDecision: "allow" | "block", grant = 100) {
	return mock(async (url: string) => {
		const u = String(url);
		if (
			u.includes("/v1/agents") &&
			!u.includes("rules") &&
			!u.includes("metrics")
		) {
			return new Response(JSON.stringify({ agentId: AGENT_ID }), {
				status: 200,
			});
		}
		if (u.includes("/v1/rules")) {
			return new Response(JSON.stringify({ rules: [metricRule] }), {
				status: 200,
			});
		}
		if (u.includes("/metrics/budget")) {
			return new Response(
				JSON.stringify({
					expires_seconds: 60,
					responses: [
						{
							id: "bytes-budget",
							decision: budgetDecision,
							grant,
							computed: null,
						},
					],
				}),
				{ status: 200 },
			);
		}
		return new Response(JSON.stringify(null), { status: 200 });
	});
}

beforeEach(() => {
	process.env.HANDLEBAR_API_KEY = "test-key";
});

afterEach(() => {
	globalThis.fetch = realFetch;
	delete process.env.HANDLEBAR_API_KEY;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApiManager ↔ BudgetManager integration", () => {
	it("initAgentRules populates BudgetManager; reevaluate() is false right after", async () => {
		globalThis.fetch = buildFetch("allow", 500) as any;

		const engine = new GovernanceEngine({
			tools: [{ name: "test_tool" }],
			rules: [],
		});
		await engine.initAgentRules({ slug: "test" }, []);

		// Grant is 500 (allow) and TTL just reset — no re-eval needed
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("budget starts at allow; after usage drains grant, next beforeTool re-evaluates and blocks", async () => {
		// bytes_in is set per-beforeTool call; each afterTool reports ~2 bytes (approxBytes({})).
		// With grant=5, three beforeTool+afterTool cycles drain grant to -1, triggering re-eval.
		let budgetCallCount = 0;
		globalThis.fetch = mock(async (url: string) => {
			const u = String(url);
			if (
				u.includes("/v1/agents") &&
				!u.includes("rules") &&
				!u.includes("metrics")
			) {
				return new Response(JSON.stringify({ agentId: AGENT_ID }), {
					status: 200,
				});
			}
			if (u.includes("/v1/rules")) {
				return new Response(JSON.stringify({ rules: [metricRule] }), {
					status: 200,
				});
			}
			if (u.includes("/metrics/budget")) {
				budgetCallCount++;
				// First call from initAgentRules: allow with grant=5
				// Subsequent calls from evalMetricWindow: block with grant=0
				const first = budgetCallCount === 1;
				return new Response(
					JSON.stringify({
						expires_seconds: 60,
						responses: [
							{
								id: "bytes-budget",
								decision: first ? "allow" : "block",
								grant: first ? 5 : 0,
								computed: null,
							},
						],
					}),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify(null), { status: 200 });
		}) as any;

		const engine = new GovernanceEngine({
			tools: [{ name: "test_tool" }],
			rules: [],
		});
		await engine.initAgentRules({ slug: "test" }, []);

		const ctx = engine.createRunContext("run-1");

		// bytes_in is only tracked per beforeTool call; usage() is applied in the matching afterTool.
		// Each cycle: beforeTool sets bytes_in (~2 bytes for `{}`), afterTool reports it.
		// 3 cycles: grant goes 5→3→1→-1; on the 4th beforeTool, reevaluate() triggers the API.
		const d1 = await engine.beforeTool(ctx, "test_tool", {}); // grant=5, allow
		expect(d1.effect).toBe("allow");
		await engine.afterTool(ctx, "test_tool", 10, {}, "ok"); // grant≈3

		const d2 = await engine.beforeTool(ctx, "test_tool", {}); // grant≈3, allow
		expect(d2.effect).toBe("allow");
		await engine.afterTool(ctx, "test_tool", 10, {}, "ok"); // grant≈1

		const d3 = await engine.beforeTool(ctx, "test_tool", {}); // grant≈1, allow
		expect(d3.effect).toBe("allow");
		await engine.afterTool(ctx, "test_tool", 10, {}, "ok"); // grant≈-1

		// reevaluate() sees grant ≤ 0 → calls API → block decision loaded
		const d4 = await engine.beforeTool(ctx, "test_tool", {});
		expect(d4.effect).toBe("block");
		expect(budgetCallCount).toBeGreaterThanOrEqual(2);
	});

	it("API-side block decision in initial budget load → immediate block on first beforeTool", async () => {
		globalThis.fetch = buildFetch("block", 0) as any;

		const engine = new GovernanceEngine({
			tools: [{ name: "test_tool" }],
			rules: [],
		});
		await engine.initAgentRules({ slug: "test" }, []);

		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});
});
