import { describe, expect, it } from "bun:test";
import {
	SignalRegistry,
	compareSignal,
	resultToSignalSchema,
	sanitiseSignals,
} from "../src/signals";
import type { SubjectRef } from "../src/subjects";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnv(overrides: Partial<Parameters<SignalRegistry["eval"]>[2]> = {}) {
	return {
		ctx: {
			runId: "run-1",
			stepIndex: 0,
			history: [],
			counters: {},
			state: new Map(),
			now: () => Date.now(),
			enduser: { externalId: "u1", metadata: { role: "admin", tz: "UTC" } },
		} as any,
		call: {
			tool: { name: "test_tool", categories: ["cat-a"] },
			args: { nested: { key: "value" }, amount: 42 },
		} as any,
		subjects: [] as SubjectRef[],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Registry lifecycle
// ---------------------------------------------------------------------------

describe("SignalRegistry lifecycle", () => {
	it("register / has / unregister", () => {
		const reg = new SignalRegistry();
		expect(reg.has("s1")).toBe(false);
		reg.register("s1", () => 1);
		expect(reg.has("s1")).toBe(true);
		reg.unregister("s1");
		expect(reg.has("s1")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// eval – basic behaviour
// ---------------------------------------------------------------------------

describe("SignalRegistry.eval", () => {
	it("calls provider and returns value", async () => {
		const reg = new SignalRegistry();
		reg.register("score", async () => 0.8);

		const result = await reg.eval("score", {}, makeEnv(), new Map());
		expect(result).toEqual({ ok: true, value: 0.8 });
	});

	it("missing provider → ok: false", async () => {
		const reg = new SignalRegistry();
		const result = await reg.eval("missing", {}, makeEnv(), new Map());
		expect(result.ok).toBe(false);
	});

	it("sync provider is wrapped in Promise.resolve", async () => {
		const reg = new SignalRegistry();
		reg.register("sync", () => "hello");
		const result = await reg.eval("sync", {}, makeEnv(), new Map());
		expect(result).toEqual({ ok: true, value: "hello" });
	});

	it("provider that throws → ok: false with error", async () => {
		const reg = new SignalRegistry();
		reg.register("bad", async () => { throw new Error("fail"); });
		const result = await reg.eval("bad", {}, makeEnv(), new Map());
		expect(result.ok).toBe(false);
		expect((result as any).error).toBeInstanceOf(Error);
	});

	it("same key+args cached within a call (provider not invoked twice)", async () => {
		const reg = new SignalRegistry();
		let calls = 0;
		reg.register("counted", async () => { calls++; return 1; });

		const cache = new Map();
		const args = { x: { from: "const" as const, value: 5 } };
		await reg.eval("counted", args, makeEnv(), cache);
		await reg.eval("counted", args, makeEnv(), cache);
		expect(calls).toBe(1);
	});

	it("different args produce different cache entries", async () => {
		const reg = new SignalRegistry();
		let calls = 0;
		reg.register("multi", async (a) => { calls++; return a.x; });

		const cache = new Map();
		await reg.eval("multi", { x: { from: "const", value: 1 } }, makeEnv(), cache);
		await reg.eval("multi", { x: { from: "const", value: 2 } }, makeEnv(), cache);
		expect(calls).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// bind – each binding type
// ---------------------------------------------------------------------------

describe("SignalRegistry bind (via eval)", () => {
	it("const binding passes literal value", async () => {
		const reg = new SignalRegistry();
		let received: unknown;
		reg.register("probe", async (args) => { received = args.v; return null; });

		await reg.eval("probe", { v: { from: "const", value: "literal" } }, makeEnv(), new Map());
		expect(received).toBe("literal");
	});

	it("enduserId binding", async () => {
		const reg = new SignalRegistry();
		let received: unknown;
		reg.register("probe", async (args) => { received = args.id; return null; });

		await reg.eval("probe", { id: { from: "enduserId" } }, makeEnv(), new Map());
		expect(received).toBe("u1");
	});

	it("enduserTag binding", async () => {
		const reg = new SignalRegistry();
		let received: unknown;
		reg.register("probe", async (args) => { received = args.r; return null; });

		await reg.eval("probe", { r: { from: "enduserTag", tag: "role" } }, makeEnv(), new Map());
		expect(received).toBe("admin");
	});

	it("toolArg binding resolves dot-path", async () => {
		const reg = new SignalRegistry();
		let received: unknown;
		reg.register("probe", async (args) => { received = args.k; return null; });

		await reg.eval("probe", { k: { from: "toolArg", path: "nested.key" } }, makeEnv(), new Map());
		expect(received).toBe("value");
	});

	it("subject binding returns first matching subject value", async () => {
		const reg = new SignalRegistry();
		let received: unknown;
		reg.register("probe", async (args) => { received = args.s; return null; });

		const env = makeEnv({
			subjects: [{ subjectType: "user", value: "alice" }],
		});
		await reg.eval("probe", { s: { from: "subject", subjectType: "user" } }, env, new Map());
		expect(received).toBe("alice");
	});

	it("subject binding returns undefined when no match", async () => {
		const reg = new SignalRegistry();
		let received: unknown = "not-set";
		reg.register("probe", async (args) => { received = args.s; return null; });

		await reg.eval("probe", { s: { from: "subject", subjectType: "account" } }, makeEnv(), new Map());
		expect(received).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// compareSignal
// ---------------------------------------------------------------------------

describe("compareSignal operators", () => {
	it("eq", () => {
		expect(compareSignal("eq", 1, 1)).toBe(true);
		expect(compareSignal("eq", 1, 2)).toBe(false);
		expect(compareSignal("eq", "a", "a")).toBe(true);
	});

	it("neq", () => {
		expect(compareSignal("neq", 1, 2)).toBe(true);
		expect(compareSignal("neq", 1, 1)).toBe(false);
	});

	it("gt / gte", () => {
		expect(compareSignal("gt", 5, 3)).toBe(true);
		expect(compareSignal("gt", 3, 5)).toBe(false);
		expect(compareSignal("gte", 5, 5)).toBe(true);
		expect(compareSignal("gte", 4, 5)).toBe(false);
	});

	it("lt / lte", () => {
		expect(compareSignal("lt", 2, 5)).toBe(true);
		expect(compareSignal("lt", 5, 2)).toBe(false);
		expect(compareSignal("lte", 5, 5)).toBe(true);
		expect(compareSignal("lte", 6, 5)).toBe(false);
	});

	it("numeric ops return false for non-numbers", () => {
		expect(compareSignal("gt", "a" as any, 1)).toBe(false);
		expect(compareSignal("lt", null as any, 1)).toBe(false);
	});

	it("in: value in array", () => {
		expect(compareSignal("in", "b", ["a", "b", "c"])).toBe(true);
		expect(compareSignal("in", "x", ["a", "b"])).toBe(false);
	});

	it("in: right not an array → false", () => {
		expect(compareSignal("in", "a", "a" as any)).toBe(false);
	});

	it("nin: value not in array", () => {
		expect(compareSignal("nin", "x", ["a", "b"])).toBe(true);
		expect(compareSignal("nin", "a", ["a", "b"])).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// resultToSignalSchema
// ---------------------------------------------------------------------------

describe("resultToSignalSchema", () => {
	it("ok result is serialised", () => {
		const schema = resultToSignalSchema("my_signal", { ok: true, value: 42 });
		expect(schema?.key).toBe("my_signal");
		expect(schema?.result.ok).toBe(true);
	});

	it("error result is serialised", () => {
		const schema = resultToSignalSchema("my_signal", { ok: false, error: new Error("fail") });
		expect(schema?.result.ok).toBe(false);
	});

	it("value is JSON-stringified and truncated to 256 chars", () => {
		const long = "x".repeat(300);
		const schema = resultToSignalSchema("k", { ok: true, value: long });
		// JSON.stringify wraps in quotes then slice(0,256) applied
		expect((schema?.result as any).value.length).toBeLessThanOrEqual(256);
	});
});

// ---------------------------------------------------------------------------
// sanitiseSignals
// ---------------------------------------------------------------------------

describe("sanitiseSignals", () => {
	it("preserves signals when count < 100", () => {
		const signals = Array.from({ length: 5 }, (_, i) => ({
			key: `sig-${i}`,
			result: { ok: true as const, value: "v" },
			args: undefined,
		}));
		expect(sanitiseSignals(signals)).toHaveLength(5);
	});

	it("truncates to 100 signals", () => {
		const signals = Array.from({ length: 150 }, (_, i) => ({
			key: `s${i}`,
			result: { ok: true as const, value: "v" },
			args: undefined,
		}));
		expect(sanitiseSignals(signals)).toHaveLength(100);
	});

	it("truncates key to 256 chars", () => {
		const signals = [{ key: "k".repeat(300), result: { ok: true as const, value: "v" }, args: undefined }];
		expect(sanitiseSignals(signals)[0].key).toHaveLength(256);
	});

	it("truncates ok result value to 256 chars", () => {
		const signals = [{ key: "k", result: { ok: true as const, value: "v".repeat(300) }, args: undefined }];
		expect((sanitiseSignals(signals)[0].result as any).value).toHaveLength(256);
	});

	it("error result is passed through unchanged", () => {
		const err = new Error("oops");
		const signals = [{ key: "k", result: { ok: false as const, error: err }, args: undefined }];
		expect(sanitiseSignals(signals)[0].result).toEqual({ ok: false, error: err });
	});

	it("truncates args to 100 items and each arg to 256 chars", () => {
		const signals = [{
			key: "k",
			result: { ok: true as const, value: "v" },
			args: Array(120).fill("x".repeat(300)),
		}];
		const result = sanitiseSignals(signals);
		expect(result[0].args).toHaveLength(100);
		expect(result[0].args![0]).toHaveLength(256);
	});
});
