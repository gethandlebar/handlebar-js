import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AuditEvent } from "@handlebar/governance-schema";
import { ApiManager } from "../src/api/manager";
import type { RunInternalConfig } from "../src/run";
import { Run } from "../src/run";
import { SinkBus } from "../src/sinks/bus";
import { FAILOPEN_DECISION } from "../src/types";

const ALLOW = {
	verdict: "ALLOW" as const,
	control: "CONTINUE" as const,
	cause: { kind: "ALLOW" as const },
	message: "ok",
	evaluatedRules: [],
};

const BLOCK = {
	verdict: "BLOCK" as const,
	control: "TERMINATE" as const,
	cause: { kind: "RULE_VIOLATION" as const, ruleId: "r1" },
	message: "blocked",
	evaluatedRules: [
		{ ruleId: "r1", enabled: true, matched: true, violated: true },
	],
};

const originalFetch = globalThis.fetch;

function makeApi(response: typeof ALLOW | typeof BLOCK = ALLOW) {
	globalThis.fetch = mock(async () => Response.json(response)) as typeof fetch;
	return new ApiManager({
		apiKey: "test-key",
		apiEndpoint: "https://api.example.com",
		_retryBaseMs: 1,
	});
}

function makeBus() {
	const events: AuditEvent[] = [];
	const bus = new SinkBus();
	bus.add({
		writeBatch(_agentId, evts) {
			events.push(...evts);
		},
	});
	return { bus, events };
}

function makeRun(
	overrides?: Partial<RunInternalConfig>,
	apiResponse: typeof ALLOW | typeof BLOCK = ALLOW,
): {
	run: Run;
	events: AuditEvent[];
} {
	const { bus, events } = makeBus();
	const run = new Run({
		runConfig: { runId: "run-1" },
		agentId: "agent-1",
		enforceMode: "enforce",
		failClosed: false,
		api: makeApi(apiResponse),
		bus,
		...overrides,
	});
	return { run, events };
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

describe("Run lifecycle", () => {
	test("emits run.started on construction", () => {
		const { events } = makeRun();
		expect(events.some((e) => e.kind === "run.started")).toBe(true);
	});

	test("emits run.ended on end()", async () => {
		const { run, events } = makeRun();
		await run.end("success");
		expect(events.some((e) => e.kind === "run.ended")).toBe(true);
		const ended = events.find((e) => e.kind === "run.ended") as Extract<
			AuditEvent,
			{ kind: "run.ended" }
		>;
		expect(ended?.data.status).toBe("success");
	});

	test("end() is idempotent — calling twice emits only one run.ended", async () => {
		const { run, events } = makeRun();
		await run.end("success");
		await run.end("success");
		expect(events.filter((e) => e.kind === "run.ended")).toHaveLength(1);
	});

	test("isEnded is false initially, true after end()", async () => {
		const { run } = makeRun();
		expect(run.isEnded).toBe(false);
		await run.end();
		expect(run.isEnded).toBe(true);
	});

	test("auto-closes after TTL", async () => {
		const { bus, events } = makeBus();
		const run = new Run({
			runConfig: { runId: "run-ttl", runTtlMs: 30 },
			agentId: "agent-1",
			enforceMode: "enforce",
			failClosed: false,
			api: makeApi(),
			bus,
		});
		await new Promise((r) => setTimeout(r, 60));
		expect(run.isEnded).toBe(true);
		const ended = events.find((e) => e.kind === "run.ended") as Extract<
			AuditEvent,
			{ kind: "run.ended" }
		>;
		expect(ended?.data.status).toBe("timeout");
	});
});

// ---------------------------------------------------------------------------
// beforeTool
// ---------------------------------------------------------------------------

describe("beforeTool", () => {
	test("returns ALLOW decision from server", async () => {
		const { run } = makeRun({}, ALLOW);
		const d = await run.beforeTool("search", { q: "hello" });
		expect(d.verdict).toBe("ALLOW");
	});

	test("returns BLOCK decision from server", async () => {
		const { run } = makeRun({}, BLOCK);
		const d = await run.beforeTool("delete_file", { path: "/etc/passwd" });
		expect(d.verdict).toBe("BLOCK");
	});

	test("emits tool.decision event", async () => {
		const { run, events } = makeRun({}, ALLOW);
		await run.beforeTool("search", { q: "hello" });
		expect(events.some((e) => e.kind === "tool.decision")).toBe(true);
	});

	test("shadow mode: always returns ALLOW even when server says BLOCK", async () => {
		const { run } = makeRun({ enforceMode: "shadow" }, BLOCK);
		const d = await run.beforeTool("delete_file", { path: "/" });
		expect(d).toEqual(FAILOPEN_DECISION);
	});

	test("off mode: skips API call and returns ALLOW", async () => {
		let fetchCalled = false;
		globalThis.fetch = mock(async () => {
			fetchCalled = true;
			return Response.json(BLOCK);
		}) as typeof fetch;
		const { bus } = makeBus();
		const run = new Run({
			runConfig: { runId: "run-off" },
			agentId: "agent-1",
			enforceMode: "off",
			failClosed: false,
			api: new ApiManager({
				apiKey: "key",
				apiEndpoint: "https://api.example.com",
			}),
			bus,
		});
		const d = await run.beforeTool("anything", {});
		expect(d).toEqual(FAILOPEN_DECISION);
		expect(fetchCalled).toBe(false);
	});

	test("returns ALLOW after run is ended", async () => {
		const { run } = makeRun({}, BLOCK);
		await run.end();
		const d = await run.beforeTool("search", {});
		expect(d).toEqual(FAILOPEN_DECISION);
	});
});

// ---------------------------------------------------------------------------
// afterTool
// ---------------------------------------------------------------------------

describe("afterTool", () => {
	test("increments stepIndex", async () => {
		const { run } = makeRun();
		expect(run.currentStepIndex).toBe(0);
		await run.afterTool("search", {}, { results: [] }, 50);
		expect(run.currentStepIndex).toBe(1);
		await run.afterTool("search", {}, { results: [] }, 50);
		expect(run.currentStepIndex).toBe(2);
	});

	test("emits tool.result event", async () => {
		const { run, events } = makeRun();
		await run.afterTool("search", {}, "ok", 10);
		expect(events.some((e) => e.kind === "tool.result")).toBe(true);
	});

	test("records tool call in history", async () => {
		const { run } = makeRun();
		await run.afterTool("search", { q: "x" }, "result", 10);
		expect(run.getHistory()).toHaveLength(1);
		expect(run.getHistory()[0].toolName).toBe("search");
	});

	test("emits error outcome when error provided", async () => {
		const { run, events } = makeRun();
		await run.afterTool("search", {}, null, 5, new Error("fail"));
		const result = events.find((e) => e.kind === "tool.result") as Extract<
			AuditEvent,
			{ kind: "tool.result" }
		>;
		expect(result?.data.outcome).toBe("error");
	});

	test("shadow mode: always returns ALLOW from afterTool", async () => {
		const { run } = makeRun({ enforceMode: "shadow" }, BLOCK);
		const d = await run.afterTool("search", {}, "ok", 10);
		expect(d).toEqual(FAILOPEN_DECISION);
	});
});

// ---------------------------------------------------------------------------
// afterLlm
// ---------------------------------------------------------------------------

describe("afterLlm", () => {
	test("re-derives outputText from content", async () => {
		const { run } = makeRun();
		const response = await run.afterLlm({
			content: [
				{ type: "text", text: "Hello " },
				{ type: "text", text: "world" },
			],
			model: { name: "gpt-4" },
		});
		expect(response.outputText).toBe("Hello world");
	});

	test("emits llm.result when usage is provided", async () => {
		const { run, events } = makeRun();
		await run.afterLlm({
			content: [{ type: "text", text: "hi" }],
			model: { name: "gpt-4", provider: "openai" },
			usage: { inputTokens: 10, outputTokens: 5 },
			durationMs: 200,
		});
		expect(events.some((e) => e.kind === "llm.result")).toBe(true);
	});

	test("does not emit llm.result when no usage provided", async () => {
		const { run, events } = makeRun();
		await run.afterLlm({
			content: [{ type: "text", text: "hi" }],
			model: { name: "gpt-4" },
		});
		expect(events.some((e) => e.kind === "llm.result")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Concurrent run isolation
// ---------------------------------------------------------------------------

describe("concurrent run isolation", () => {
	test("two runs have independent stepIndex and history", async () => {
		const { bus: bus1 } = makeBus();
		const { bus: bus2 } = makeBus();

		const api1 = makeApi(ALLOW);
		const api2 = makeApi(ALLOW);

		const run1 = new Run({
			runConfig: { runId: "run-a" },
			agentId: "agent-1",
			enforceMode: "enforce",
			failClosed: false,
			api: api1,
			bus: bus1,
		});
		const run2 = new Run({
			runConfig: { runId: "run-b" },
			agentId: "agent-1",
			enforceMode: "enforce",
			failClosed: false,
			api: api2,
			bus: bus2,
		});

		await run1.afterTool("tool-a", {}, "r1", 10);
		await run1.afterTool("tool-a", {}, "r2", 10);
		await run2.afterTool("tool-b", {}, "r3", 10);

		expect(run1.currentStepIndex).toBe(2);
		expect(run2.currentStepIndex).toBe(1);
		expect(run1.getHistory()).toHaveLength(2);
		expect(run2.getHistory()).toHaveLength(1);
		expect(run1.getHistory()[0].toolName).toBe("tool-a");
		expect(run2.getHistory()[0].toolName).toBe("tool-b");
	});
});
