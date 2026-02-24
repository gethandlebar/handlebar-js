import { afterEach, describe, expect, mock, test } from "bun:test";
import { ApiManager } from "../src/api/manager";
import {
	FAILCLOSED_DECISION,
	FAILOPEN_DECISION,
} from "../src/types";

const ALLOW_DECISION = {
	verdict: "ALLOW",
	control: "CONTINUE",
	cause: { kind: "ALLOW" },
	message: "All clear",
	evaluatedRules: [],
};

const BLOCK_DECISION = {
	verdict: "BLOCK",
	control: "TERMINATE",
	cause: { kind: "RULE_VIOLATION", ruleId: "rule-1" },
	message: "Blocked",
	evaluatedRules: [
		{ ruleId: "rule-1", enabled: true, matched: true, violated: true },
	],
};

function makeManager(overrides?: { failClosed?: boolean; apiKey?: string }) {
	return new ApiManager({
		apiKey: overrides?.apiKey ?? "test-key",
		apiEndpoint: "https://api.example.com",
		failClosed: overrides?.failClosed ?? false,
		_retryBaseMs: 1, // fast retries in tests
	});
}

function mockFetch(
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
	globalThis.fetch = mock(handler as typeof fetch);
}

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// upsertAgent
// ---------------------------------------------------------------------------

describe("upsertAgent", () => {
	test("returns agentId on success", async () => {
		mockFetch(async () => Response.json({ agentId: "agent-abc" }));
		const mgr = makeManager();
		const id = await mgr.upsertAgent({ slug: "my-agent" });
		expect(id).toBe("agent-abc");
	});

	test("returns null when no apiKey configured", async () => {
		const mgr = makeManager({ apiKey: "" });
		const id = await mgr.upsertAgent({ slug: "my-agent" });
		expect(id).toBeNull();
	});

	test("returns null on HTTP error", async () => {
		mockFetch(async () => new Response(null, { status: 500 }));
		const mgr = makeManager();
		const id = await mgr.upsertAgent({ slug: "my-agent" });
		expect(id).toBeNull();
	});

	test("includes tools in request body when provided", async () => {
		let parsedBody: unknown;
		mockFetch(async (_url, init) => {
			parsedBody = JSON.parse(init?.body as string);
			return Response.json({ agentId: "agent-xyz" });
		});
		const mgr = makeManager();
		await mgr.upsertAgent({ slug: "my-agent" }, [
			{ name: "search", tags: ["read"] },
		]);
		expect((parsedBody as { tools: unknown[] }).tools).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// evaluate — failopen / failclosed
// ---------------------------------------------------------------------------

describe("evaluate", () => {
	const req = {
		phase: "tool.before" as const,
		agentId: "agent-1",
		tool: { name: "write_file" },
		args: { path: "/tmp/x" },
	};

	test("returns parsed decision from server", async () => {
		mockFetch(async () => Response.json(ALLOW_DECISION));
		const mgr = makeManager();
		const d = await mgr.evaluate("run-1", req);
		expect(d.verdict).toBe("ALLOW");
		expect(d.control).toBe("CONTINUE");
	});

	test("failopen: returns ALLOW on network error", async () => {
		mockFetch(async () => {
			throw new Error("network down");
		});
		const mgr = makeManager({ failClosed: false });
		const d = await mgr.evaluate("run-1", req);
		expect(d).toEqual(FAILOPEN_DECISION);
	});

	test("failclosed: returns BLOCK on network error", async () => {
		mockFetch(async () => {
			throw new Error("network down");
		});
		const mgr = makeManager({ failClosed: true });
		const d = await mgr.evaluate("run-1", req);
		expect(d).toEqual(FAILCLOSED_DECISION);
	});

	test("failopen: returns ALLOW on invalid response schema", async () => {
		mockFetch(async () => Response.json({ bad: "shape" }));
		const mgr = makeManager({ failClosed: false });
		const d = await mgr.evaluate("run-1", req);
		expect(d).toEqual(FAILOPEN_DECISION);
	});

	test("failopen: returns ALLOW on 5xx", async () => {
		// We need retries to exhaust fast — use a tiny base.
		// ApiManager doesn't expose _retryBaseMs, so this tests the public surface.
		mockFetch(async () => new Response(null, { status: 503 }));
		const mgr = makeManager({ failClosed: false });
		// Override postWithRetry base via a small private hack for test speed.
		// biome-ignore lint/suspicious/noExplicitAny: test-only
		(mgr as any)["postWithRetry"] = async () =>
			new Response(null, { status: 503 });
		const d = await mgr.evaluate("run-1", req);
		expect(d).toEqual(FAILOPEN_DECISION);
	});

	test("returns BLOCK decision correctly", async () => {
		mockFetch(async () => Response.json(BLOCK_DECISION));
		const mgr = makeManager();
		const d = await mgr.evaluate("run-1", req);
		expect(d.verdict).toBe("BLOCK");
		expect(d.cause).toMatchObject({ kind: "RULE_VIOLATION" });
	});

	test("failopen when no apiKey configured", async () => {
		const mgr = makeManager({ apiKey: "" });
		const d = await mgr.evaluate("run-1", req);
		expect(d).toEqual(FAILOPEN_DECISION);
	});

	test("failclosed when no apiKey configured", async () => {
		const mgr = new ApiManager({
			apiKey: "",
			apiEndpoint: "https://api.example.com",
			failClosed: true,
			_retryBaseMs: 1,
		});
		const d = await mgr.evaluate("run-1", req);
		expect(d).toEqual(FAILCLOSED_DECISION);
	});
});

// ---------------------------------------------------------------------------
// startRun
// ---------------------------------------------------------------------------

describe("startRun", () => {
	test("returns lockdown inactive on success", async () => {
		mockFetch(async () => Response.json({ lockdown: { active: false } }));
		const mgr = makeManager();
		const status = await mgr.startRun("run-1", "agent-1");
		expect(status.active).toBe(false);
	});

	test("returns lockdown active with reason", async () => {
		mockFetch(async () =>
			Response.json({
				lockdown: { active: true, reason: "Manual override", until_ts: null },
			}),
		);
		const mgr = makeManager();
		const status = await mgr.startRun("run-1", "agent-1");
		expect(status.active).toBe(true);
		expect(status.reason).toBe("Manual override");
	});

	test("returns inactive lockdown on HTTP error", async () => {
		mockFetch(async () => new Response(null, { status: 500 }));
		const mgr = makeManager();
		const status = await mgr.startRun("run-1", "agent-1");
		expect(status.active).toBe(false);
	});

	test("returns inactive lockdown when no apiKey", async () => {
		const mgr = makeManager({ apiKey: "" });
		const status = await mgr.startRun("run-1", "agent-1");
		expect(status.active).toBe(false);
	});
});
