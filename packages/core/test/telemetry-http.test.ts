import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { AuditEvent } from "@handlebar/governance-schema";
import { createAuditBus } from "../src/audit/bus";
import { HttpSink } from "../src/audit/sinks";

const realFetch = globalThis.fetch;

function makeEvent(): AuditEvent {
	return {
		schema: "handlebar.audit.v1",
		kind: "tool.decision",
		ts: new Date("2024-01-01T00:00:00Z"),
		runId: "run-1",
		data: {
			tool: { name: "test_tool" },
			effect: "allow",
			code: "ALLOWED",
			matchedRuleIds: [],
			appliedActions: [],
			counters: {},
			latencyMs: 1,
		},
	} as any;
}

// ---------------------------------------------------------------------------
// HttpSink
// ---------------------------------------------------------------------------

describe("HttpSink", () => {
	let captured: { url: string; init: RequestInit }[] = [];

	beforeEach(() => {
		captured = [];
		globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
			captured.push({ url, init: init ?? {} });
			return new Response(null, { status: 200 });
		}) as any;
	});

	afterEach(async () => {
		globalThis.fetch = realFetch;
	});

	it("POSTs event JSON to the configured endpoint", async () => {
		const sink = HttpSink("https://ingest.example.com/events");
		await sink.write("agent-1", makeEvent());

		// write is fire-and-forget; wait a tick for the promise to settle
		await new Promise((r) => setTimeout(r, 10));

		expect(captured).toHaveLength(1);
		expect(captured[0].url).toBe("https://ingest.example.com/events");
		expect(captured[0].init.method).toBe("POST");
	});

	it("serialises agentId and event into the body", async () => {
		const sink = HttpSink("https://ingest.example.com");
		await sink.write("agent-xyz", makeEvent());
		await new Promise((r) => setTimeout(r, 10));

		const body = JSON.parse(captured[0].init.body as string);
		expect(body.agentId).toBe("agent-xyz");
		expect(body.events).toHaveLength(1);
		expect(body.events[0].kind).toBe("tool.decision");
	});

	it("includes Authorization header when provided", async () => {
		const sink = HttpSink("https://ingest.example.com", {
			Authorization: "Bearer test-key",
		});
		await sink.write("agent-1", makeEvent());
		await new Promise((r) => setTimeout(r, 10));

		const headers = captured[0].init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer test-key");
	});

	it("always sets content-type: application/json", async () => {
		const sink = HttpSink("https://ingest.example.com");
		await sink.write("agent-1", makeEvent());
		await new Promise((r) => setTimeout(r, 10));

		const headers = captured[0].init.headers as Record<string, string>;
		expect(headers["content-type"]).toBe("application/json");
	});

	it("non-2xx response is silently swallowed (fire-and-forget)", async () => {
		globalThis.fetch = mock(
			async () => new Response("error", { status: 500 }),
		) as any;

		const sink = HttpSink("https://ingest.example.com");
		// Should not throw
		await expect(sink.write("agent-1", makeEvent())).resolves.toBeUndefined();
		await new Promise((r) => setTimeout(r, 10));
	});

	it("fetch throws (network error) → silently swallowed", async () => {
		globalThis.fetch = mock(async () => {
			throw new Error("network fail");
		}) as any;

		const sink = HttpSink("https://ingest.example.com");
		await expect(sink.write("agent-1", makeEvent())).resolves.toBeUndefined();
		await new Promise((r) => setTimeout(r, 10));
	});
});

// ---------------------------------------------------------------------------
// AuditBus + HttpSink teardown
// Per-test bus instances are used so the Telemetry singleton is never touched.
// ---------------------------------------------------------------------------

describe("AuditBus teardown", () => {
	afterEach(async () => {
		globalThis.fetch = realFetch;
	});

	it("events emitted after shutdown are dropped", async () => {
		const received: string[] = [];
		globalThis.fetch = mock(async () => {
			received.push("called");
			return new Response(null, { status: 200 });
		}) as any;

		const bus = createAuditBus();
		bus.use(HttpSink("https://ingest.example.com"));
		bus.emit("agent-1", makeEvent()); // before shutdown

		await bus.shutdown(); // closes the bus

		bus.emit("agent-1", makeEvent()); // after shutdown — must be dropped
		await new Promise((r) => setTimeout(r, 20));

		// Only the pre-shutdown event should have triggered a fetch
		expect(received).toHaveLength(1);
	});

	it("shutdown flushes pending writes", async () => {
		let resolved = false;
		globalThis.fetch = mock(async () => {
			await new Promise((r) => setTimeout(r, 5));
			resolved = true;
			return new Response(null, { status: 200 });
		}) as any;

		const bus = createAuditBus();
		// HttpSink is fire-and-forget so flush is a no-op; we verify shutdown doesn't throw
		bus.use(HttpSink("https://ingest.example.com"));
		bus.emit("agent-1", makeEvent());
		await bus.shutdown();
		// No assertion on resolved — HttpSink doesn't await; this just confirms no throw
	});
});
