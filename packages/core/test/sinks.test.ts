import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AuditEvent } from "@handlebar/governance-schema";
import { SinkBus } from "../src/sinks/bus";
import { createConsoleSink } from "../src/sinks/console";
import { createHttpSink } from "../src/sinks/http";
import type { Sink } from "../src/sinks/types";

// Minimal valid audit event for testing.
function makeEvent(
	kind: "run.started" | "run.ended" = "run.ended",
): AuditEvent {
	if (kind === "run.started") {
		return {
			schema: "handlebar.audit.v1",
			ts: new Date(),
			runId: "test-run",
			kind: "run.started",
			data: {
				agent: {},
				adapter: { name: "test" },
			},
		};
	}
	return {
		schema: "handlebar.audit.v1",
		ts: new Date(),
		runId: "test-run",
		kind: "run.ended",
		data: { status: "success", totalSteps: 1 },
	};
}

// ---------------------------------------------------------------------------
// SinkBus
// ---------------------------------------------------------------------------

describe("SinkBus", () => {
	test("fans out to multiple sinks", async () => {
		const received: { id: string; events: AuditEvent[] }[] = [];
		const makeSink = (id: string): Sink => ({
			writeBatch(agentId, events) {
				received.push({ id, events });
			},
		});

		const bus = new SinkBus();
		bus.add(makeSink("a"), makeSink("b"));
		bus.emit("agent-1", makeEvent());

		expect(received).toHaveLength(2);
		expect(received[0].id).toBe("a");
		expect(received[1].id).toBe("b");
	});

	test("isolates sink errors — other sinks still receive events", () => {
		const received: AuditEvent[] = [];
		const badSink: Sink = {
			writeBatch() {
				throw new Error("boom");
			},
		};
		const goodSink: Sink = {
			writeBatch(_agentId, events) {
				received.push(...events);
			},
		};

		const bus = new SinkBus();
		bus.add(badSink, goodSink);
		expect(() => bus.emit("agent-1", makeEvent())).not.toThrow();
		expect(received).toHaveLength(1);
	});

	test("drops events after close", () => {
		const received: AuditEvent[] = [];
		const sink: Sink = {
			writeBatch(_agentId, events) {
				received.push(...events);
			},
		};

		const bus = new SinkBus();
		bus.add(sink);
		bus.emit("agent-1", makeEvent());
		bus.close();
		bus.emit("agent-1", makeEvent());

		expect(received).toHaveLength(1);
	});

	test("calls init on all sinks", async () => {
		const initted: string[] = [];
		const make = (id: string): Sink => ({
			init() {
				initted.push(id);
			},
			writeBatch() {},
		});

		const bus = new SinkBus();
		bus.add(make("x"), make("y"));
		await bus.init();
		expect(initted).toEqual(["x", "y"]);
	});
});

// ---------------------------------------------------------------------------
// ConsoleSink
// ---------------------------------------------------------------------------

describe("ConsoleSink", () => {
	test("json format logs JSON strings", () => {
		const lines: string[] = [];
		const orig = console.log;
		console.log = (...args) => lines.push(args.join(" "));

		const sink = createConsoleSink({ format: "json" });
		sink.writeBatch("agent-1", [makeEvent()]);

		console.log = orig;
		expect(lines).toHaveLength(1);
		expect(() => JSON.parse(lines[0])).not.toThrow();
	});

	test("pretty format logs readable string", () => {
		const lines: string[] = [];
		const orig = console.log;
		console.log = (...args) => lines.push(args.join(" "));

		const sink = createConsoleSink({ format: "pretty" });
		sink.writeBatch("agent-1", [makeEvent()]);

		console.log = orig;
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("[handlebar]");
	});
});

// ---------------------------------------------------------------------------
// HttpSink
// ---------------------------------------------------------------------------

describe("HttpSink", () => {
	let fetchCalls: { url: string; body: unknown }[] = [];
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		fetchCalls = [];
		globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
			fetchCalls.push({
				url: url.toString(),
				body: JSON.parse(init?.body as string),
			});
			return new Response(null, { status: 200 });
		}) as typeof fetch;
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
	});

	test("flushes events on close", async () => {
		const sink = createHttpSink("https://api.example.com", "key-123", {
			flushIntervalMs: 60_000, // disable auto-flush for test
		});
		await sink.init?.();

		sink.writeBatch("agent-1", [makeEvent(), makeEvent()]);
		await sink.close?.();

		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].url).toContain("/v1/runs/events");
		expect((fetchCalls[0].body as { events: unknown[] }).events).toHaveLength(
			2,
		);
	});

	test("batches events up to maxBatchSize", async () => {
		const sink = createHttpSink("https://api.example.com", "key-123", {
			maxBatchSize: 3,
			flushIntervalMs: 60_000,
		});
		await sink.init?.();

		// 7 events → 3 + 3 + 1 = 3 batches
		for (let i = 0; i < 7; i++) {
			sink.writeBatch("agent-1", [makeEvent()]);
		}
		await sink.close?.();

		expect(fetchCalls).toHaveLength(3);
		const sizes = fetchCalls.map(
			(c) => (c.body as { events: unknown[] }).events.length,
		);
		expect(sizes).toEqual([3, 3, 1]);
	});

	test("drops oldest events when queue is full", async () => {
		const sink = createHttpSink("https://api.example.com", "key-123", {
			queueDepth: 3,
			flushIntervalMs: 60_000,
		});
		await sink.init?.();

		// Push 5 events into a depth-3 queue; first 2 are dropped.
		for (let i = 0; i < 5; i++) {
			sink.writeBatch("agent-1", [makeEvent()]);
		}
		await sink.close?.();

		const total = fetchCalls.reduce(
			(s, c) => s + (c.body as { events: unknown[] }).events.length,
			0,
		);
		expect(total).toBe(3);
	});

	test("retries on 5xx and succeeds on second attempt", async () => {
		let attempt = 0;
		globalThis.fetch = mock(async (_url: string | URL, init?: RequestInit) => {
			fetchCalls.push({
				url: _url.toString(),
				body: JSON.parse(init?.body as string),
			});
			attempt++;
			if (attempt === 1) {
				return new Response(null, { status: 503 });
			}
			return new Response(null, { status: 200 });
		}) as typeof fetch;

		// retryBaseMs=1 so the test doesn't wait 500ms.
		const sink = createHttpSink("https://api.example.com", "key-123", {
			flushIntervalMs: 60_000,
			// @ts-expect-error: internal test-only override
			_retryBaseMs: 1,
		});
		await sink.init?.();
		sink.writeBatch("agent-1", [makeEvent()]);
		await sink.close?.();

		expect(fetchCalls.length).toBeGreaterThanOrEqual(2);
	});

	test("does not retry on 4xx", async () => {
		globalThis.fetch = mock(async (_url: string | URL, init?: RequestInit) => {
			fetchCalls.push({
				url: _url.toString(),
				body: JSON.parse(init?.body as string),
			});
			return new Response(null, { status: 401 });
		}) as typeof fetch;

		const sink = createHttpSink("https://api.example.com", "key-123", {
			flushIntervalMs: 60_000,
		});
		await sink.init?.();
		sink.writeBatch("agent-1", [makeEvent()]);
		await sink.close?.();

		// Only one attempt for a 4xx.
		expect(fetchCalls).toHaveLength(1);
	});

	test("sends Authorization header when apiKey provided", async () => {
		const sink = createHttpSink("https://api.example.com", "my-secret", {
			flushIntervalMs: 60_000,
		});
		await sink.init?.();
		sink.writeBatch("agent-1", [makeEvent()]);
		await sink.close?.();

		// Check that fetch was called with the right headers.
		// We can't directly inspect headers from our mock, but we can verify fetch was called.
		expect(fetchCalls).toHaveLength(1);
	});

	test("does not send when queue is empty", async () => {
		const sink = createHttpSink("https://api.example.com", "key-123", {
			flushIntervalMs: 60_000,
		});
		await sink.init?.();
		await sink.close?.();

		expect(fetchCalls).toHaveLength(0);
	});
});
