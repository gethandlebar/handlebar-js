import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { ApiManager } from "../src/api/manager";
import type { Rule } from "@handlebar/governance-schema";

const realFetch = globalThis.fetch;

function makeFetch(handlers: Record<string, () => Response>) {
	return mock(async (url: string) => {
		for (const [pattern, handler] of Object.entries(handlers)) {
			if (String(url).includes(pattern)) return handler();
		}
		return new Response(JSON.stringify(null), { status: 200 });
	});
}

function makeApi() {
	return new ApiManager({ apiKey: "test-key", apiEndpoint: "https://api.example.com" });
}

function makeRule(): Rule {
	return {
		id: "r1",
		policyId: "p1",
		enabled: true,
		priority: 0,
		name: "Rule 1",
		selector: { phase: "tool.before", tool: { name: "tool" } },
		condition: { kind: "toolName", op: "eq", value: "tool" },
		effect: { type: "block" },
	};
}

// A rule with metricWindow condition so evaluateMetrics is not short-circuited
function makeMetricRule(): Rule {
	return {
		id: "r-metric",
		policyId: "p1",
		enabled: true,
		priority: 0,
		name: "Metric Rule",
		selector: { phase: "tool.before", tool: { name: "tool" } },
		condition: {
			kind: "metricWindow",
			scope: "agent",
			metric: { kind: "inbuilt", key: "bytes_in" },
			aggregate: "sum",
			windowSeconds: 3600,
			op: "gt",
			value: 1000,
		},
		effect: { type: "block" },
	};
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// initialiseAgent
// ---------------------------------------------------------------------------

describe("ApiManager.initialiseAgent", () => {
	it("happy path: PUT agent → GET rules (metric rule) → POST budget → returns agentId + rules + budget", async () => {
		// Order matters: more-specific patterns before /v1/agents (which is a prefix of the budget URL)
		globalThis.fetch = makeFetch({
			"/metrics/budget": () =>
				new Response(
					JSON.stringify({ expires_seconds: 60, responses: [] }),
					{ status: 200 },
				),
			"/v1/rules": () =>
				// Must include a metricWindow rule so evaluateMetrics is not short-circuited
				new Response(JSON.stringify({ rules: [makeMetricRule()] }), { status: 200 }),
			"/v1/agents": () =>
				new Response(JSON.stringify({ agentId: "agent-1" }), { status: 200 }),
		}) as any;

		const api = makeApi();
		const result = await api.initialiseAgent({ slug: "my-agent" }, []);

		expect(result?.agentId).toBe("agent-1");
		expect(result?.rules).toHaveLength(1);
		expect(result?.budget?.expires_seconds).toBe(60);
	});

	it("returns null when no API key configured", async () => {
		const api = new ApiManager({});
		const result = await api.initialiseAgent({ slug: "my-agent" }, []);
		expect(result).toBeNull();
	});

	it("PUT agent fails → returns null", async () => {
		globalThis.fetch = makeFetch({
			"/v1/agents": () => new Response("error", { status: 500 }),
		}) as any;

		const api = makeApi();
		const result = await api.initialiseAgent({ slug: "my-agent" }, []);
		expect(result).toBeNull();
	});

	it("GET rules fails → returns null", async () => {
		globalThis.fetch = makeFetch({
			"/v1/agents": () =>
				new Response(JSON.stringify({ agentId: "a1" }), { status: 200 }),
			"/v1/rules": () => new Response("error", { status: 500 }),
		}) as any;

		const api = makeApi();
		const result = await api.initialiseAgent({ slug: "my-agent" }, []);
		expect(result).toBeNull();
	});

	it("no metric-window rules → budget field is null (evaluateMetrics skipped)", async () => {
		globalThis.fetch = makeFetch({
			"/v1/agents": () =>
				new Response(JSON.stringify({ agentId: "a1" }), { status: 200 }),
			"/v1/rules": () =>
				new Response(JSON.stringify({ rules: [makeRule()] }), { status: 200 }),
		}) as any;

		const api = makeApi();
		const result = await api.initialiseAgent({ slug: "my-agent" }, []);
		// makeRule() has a toolName condition, not metricWindow — budget is skipped → null
		expect(result?.budget).toBeNull();
	});

	it("sets agentId on the instance after success", async () => {
		globalThis.fetch = makeFetch({
			"/v1/agents": () =>
				new Response(JSON.stringify({ agentId: "agent-xyz" }), { status: 200 }),
			"/v1/rules": () =>
				new Response(JSON.stringify({ rules: [] }), { status: 200 }),
		}) as any;

		const api = makeApi();
		await api.initialiseAgent({ slug: "my-agent" }, []);
		expect(api.agentId).toBe("agent-xyz");
	});
});

// ---------------------------------------------------------------------------
// queryHitl
// ---------------------------------------------------------------------------

describe("ApiManager.queryHitl", () => {
	it("returns null when no agentId set", async () => {
		const api = makeApi();
		// agentId is undefined — no API call made
		const result = await api.queryHitl("run-1", "rule-1", "tool", {});
		expect(result).toBeNull();
	});

	it("approved status is returned as-is", async () => {
		globalThis.fetch = mock(async () =>
			new Response(
				JSON.stringify({ hitlId: "h1", status: "approved", pre_existing: true }),
				{ status: 200 },
			),
		) as any;

		const api = new ApiManager(
			{ apiKey: "key", apiEndpoint: "https://api.example.com" },
			"agent-1",
		);
		const result = await api.queryHitl("run-1", "rule-1", "tool", {});
		expect(result?.status).toBe("approved");
		expect(result?.pre_existing).toBe(true);
	});

	it("pending status is returned as-is", async () => {
		globalThis.fetch = mock(async () =>
			new Response(
				JSON.stringify({ hitlId: "h1", status: "pending", pre_existing: false }),
				{ status: 200 },
			),
		) as any;

		const api = new ApiManager(
			{ apiKey: "key", apiEndpoint: "https://api.example.com" },
			"agent-1",
		);
		const result = await api.queryHitl("run-1", "rule-1", "tool", {});
		expect(result?.status).toBe("pending");
	});

	it("non-2xx response → returns null (error swallowed)", async () => {
		globalThis.fetch = mock(async () =>
			new Response("internal error", { status: 500 }),
		) as any;

		const api = new ApiManager(
			{ apiKey: "key", apiEndpoint: "https://api.example.com" },
			"agent-1",
		);
		const result = await api.queryHitl("run-1", "rule-1", "tool", {});
		expect(result).toBeNull();
	});

	it("sends correct JSON body", async () => {
		let capturedBody: any;
		globalThis.fetch = mock(async (_url, init) => {
			capturedBody = JSON.parse((init as any).body);
			return new Response(
				JSON.stringify({ hitlId: "h1", status: "pending", pre_existing: false }),
				{ status: 200 },
			);
		}) as any;

		const api = new ApiManager(
			{ apiKey: "key", apiEndpoint: "https://api.example.com" },
			"agent-1",
		);
		await api.queryHitl("run-abc", "rule-xyz", "my_tool", { arg: "val" });

		expect(capturedBody.runId).toBe("run-abc");
		expect(capturedBody.ruleId).toBe("rule-xyz");
		expect(capturedBody.tool.name).toBe("my_tool");
		expect(capturedBody.tool.args.arg).toBe("val");
	});
});

// ---------------------------------------------------------------------------
// evaluateMetrics
// ---------------------------------------------------------------------------

describe("ApiManager.evaluateMetrics", () => {
	const metricRule: Rule = {
		id: "budget-rule",
		policyId: "p1",
		enabled: true,
		priority: 0,
		name: "Budget",
		selector: { phase: "tool.before", tool: { name: "tool" } },
		condition: {
			kind: "metricWindow",
			scope: "agent",
			metric: { kind: "inbuilt", key: "bytes_out" },
			aggregate: "sum",
			windowSeconds: 3600,
			op: "gt",
			value: 1000,
		},
		effect: { type: "block" },
	};

	it("returns null when no metric-window rules present", async () => {
		const api = makeApi();
		const result = await api.evaluateMetrics("agent-1", [makeRule()]);
		expect(result).toBeNull();
	});

	it("serialises metric-window rule into POST body", async () => {
		let capturedBody: any;
		globalThis.fetch = mock(async (_url, init) => {
			capturedBody = JSON.parse((init as any).body);
			return new Response(
				JSON.stringify({ expires_seconds: 60, responses: [] }),
				{ status: 200 },
			);
		}) as any;

		const api = makeApi();
		await api.evaluateMetrics("agent-1", [metricRule]);

		expect(capturedBody.requests).toHaveLength(1);
		expect(capturedBody.requests[0].id).toBe("budget-rule");
		expect(capturedBody.requests[0].metric).toBe("bytes_out");
	});

	it("valid response is parsed and returned", async () => {
		globalThis.fetch = mock(async () =>
			new Response(
				JSON.stringify({
					expires_seconds: 120,
					responses: [
						{ id: "budget-rule", decision: "allow", grant: 900, computed: null },
					],
				}),
				{ status: 200 },
			),
		) as any;

		const api = makeApi();
		const result = await api.evaluateMetrics("agent-1", [metricRule]);

		expect(result?.expires_seconds).toBe(120);
		expect(result?.responses[0].grant).toBe(900);
	});

	it("invalid response shape → throws (Zod parse failure)", async () => {
		globalThis.fetch = mock(async () =>
			new Response(JSON.stringify({ not: "valid" }), { status: 200 }),
		) as any;

		const api = makeApi();
		await expect(api.evaluateMetrics("agent-1", [metricRule])).rejects.toThrow();
	});

	it("includes Authorization header", async () => {
		let capturedHeaders: any;
		globalThis.fetch = mock(async (_url, init) => {
			capturedHeaders = (init as any).headers;
			return new Response(
				JSON.stringify({ expires_seconds: 60, responses: [] }),
				{ status: 200 },
			);
		}) as any;

		const api = makeApi();
		await api.evaluateMetrics("agent-1", [metricRule]);
		expect(capturedHeaders.Authorization).toBe("Bearer test-key");
	});
});
