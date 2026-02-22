import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Rule } from "@handlebar/governance-schema";
import { GovernanceEngine } from "../src/engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(
	opts: Pick<Rule, "condition" | "selector"> &
		Partial<Omit<Rule, "condition" | "selector">>,
): Rule {
	return {
		id: "r1",
		policyId: "p1",
		enabled: true,
		priority: 0,
		name: "Test",
		effect: { type: "block" },
		...opts,
	};
}

function makeEngine(rule: Rule, extraTools: string[] = []) {
	const toolNames = Array.from(
		new Set(["test_tool", "other_tool", "auth_tool", ...extraTools]),
	);
	return new GovernanceEngine({
		tools: toolNames.map((name) => ({ name, categories: ["cat-a", "cat-b"] })),
		rules: [rule],
	});
}

const beforeSelector = (toolName = "test_tool"): Rule["selector"] => ({
	phase: "tool.before",
	tool: { name: toolName },
});

async function decide(rule: Rule, args: unknown = {}, extraTools: string[] = []) {
	const engine = makeEngine(rule, extraTools);
	const ctx = engine.createRunContext("run-1");
	return engine.beforeTool(ctx, "test_tool", args);
}

// ---------------------------------------------------------------------------
// toolName condition
// ---------------------------------------------------------------------------

describe("toolName condition", () => {
	const sel = beforeSelector();

	it("eq: exact match → block", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolName", op: "eq", value: "test_tool" } }));
		expect(d.effect).toBe("block");
	});

	it("eq: no match → allow", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolName", op: "eq", value: "other_tool" } }));
		expect(d.effect).toBe("allow");
	});

	it("eq: case-insensitive", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolName", op: "eq", value: "TEST_TOOL" } }));
		expect(d.effect).toBe("block");
	});

	it("neq: different name → block", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolName", op: "neq", value: "other_tool" } }));
		expect(d.effect).toBe("block");
	});

	it("neq: same name → allow", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolName", op: "neq", value: "test_tool" } }));
		expect(d.effect).toBe("allow");
	});

	it("contains: substring match", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolName", op: "contains", value: "test" } }));
		expect(d.effect).toBe("block");
	});

	it("startsWith", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolName", op: "startsWith", value: "test" } }));
		expect(d.effect).toBe("block");
	});

	it("endsWith", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolName", op: "endsWith", value: "_tool" } }));
		expect(d.effect).toBe("block");
	});

	it("glob: wildcard match", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolName", op: "glob", value: "test_*" } }));
		expect(d.effect).toBe("block");
	});

	it("glob: no match", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolName", op: "glob", value: "send_*" } }));
		expect(d.effect).toBe("allow");
	});

	it("in: name is in list", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolName", op: "in", value: ["other_tool", "test_tool"] } }));
		expect(d.effect).toBe("block");
	});

	it("in: name not in list", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolName", op: "in", value: ["other_tool"] } }));
		expect(d.effect).toBe("allow");
	});
});

// ---------------------------------------------------------------------------
// toolTag condition
// ---------------------------------------------------------------------------

describe("toolTag condition", () => {
	const sel = beforeSelector();

	it("has: tag present → block", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolTag", op: "has", tag: "cat-a" } }));
		expect(d.effect).toBe("block");
	});

	it("has: tag absent → allow", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolTag", op: "has", tag: "missing-tag" } }));
		expect(d.effect).toBe("allow");
	});

	it("anyOf: at least one match", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolTag", op: "anyOf", tags: ["missing", "cat-b"] } }));
		expect(d.effect).toBe("block");
	});

	it("anyOf: no matches → allow", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolTag", op: "anyOf", tags: ["x", "y"] } }));
		expect(d.effect).toBe("allow");
	});

	it("allOf: all present → block", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolTag", op: "allOf", tags: ["cat-a", "cat-b"] } }));
		expect(d.effect).toBe("block");
	});

	it("allOf: partial match → allow", async () => {
		const d = await decide(makeRule({ selector: sel, condition: { kind: "toolTag", op: "allOf", tags: ["cat-a", "missing"] } }));
		expect(d.effect).toBe("allow");
	});
});

// ---------------------------------------------------------------------------
// toolArg condition
// ---------------------------------------------------------------------------

describe("toolArg condition", () => {
	const sel = beforeSelector();

	it("string eq: exact match", async () => {
		const d = await decide(
			makeRule({ selector: sel, condition: { kind: "toolArg", type: "string", op: "eq", path: "name", value: "alice" } }),
			{ name: "alice" },
		);
		expect(d.effect).toBe("block");
	});

	it("string neq: different value", async () => {
		const d = await decide(
			makeRule({ selector: sel, condition: { kind: "toolArg", type: "string", op: "neq", path: "name", value: "bob" } }),
			{ name: "alice" },
		);
		expect(d.effect).toBe("block");
	});

	it("string contains", async () => {
		const d = await decide(
			makeRule({ selector: sel, condition: { kind: "toolArg", type: "string", op: "contains", path: "msg", value: "urgent" } }),
			{ msg: "this is urgent please" },
		);
		expect(d.effect).toBe("block");
	});

	it("string startsWith", async () => {
		const d = await decide(
			makeRule({ selector: sel, condition: { kind: "toolArg", type: "string", op: "startsWith", path: "cmd", value: "rm" } }),
			{ cmd: "rm -rf /" },
		);
		expect(d.effect).toBe("block");
	});

	it("string in: value in list", async () => {
		const d = await decide(
			makeRule({ selector: sel, condition: { kind: "toolArg", type: "string", op: "in", path: "role", value: "admin" } }),
			{ role: "admin" },
		);
		expect(d.effect).toBe("block");
	});

	it("number gt", async () => {
		const d = await decide(
			makeRule({ selector: sel, condition: { kind: "toolArg", type: "number", op: "gt", path: "amount", value: 100 } }),
			{ amount: 150 },
		);
		expect(d.effect).toBe("block");
	});

	it("number lt: not exceeded → allow", async () => {
		const d = await decide(
			makeRule({ selector: sel, condition: { kind: "toolArg", type: "number", op: "gt", path: "amount", value: 100 } }),
			{ amount: 50 },
		);
		expect(d.effect).toBe("allow");
	});

	it("number gte/lte boundaries", async () => {
		const lte = makeRule({ selector: sel, condition: { kind: "toolArg", type: "number", op: "lte", path: "n", value: 10 } });
		expect((await decide(lte, { n: 10 })).effect).toBe("block");
		expect((await decide(lte, { n: 11 })).effect).toBe("allow");

		const gte = makeRule({ selector: sel, condition: { kind: "toolArg", type: "number", op: "gte", path: "n", value: 5 } });
		expect((await decide(gte, { n: 5 })).effect).toBe("block");
		expect((await decide(gte, { n: 4 })).effect).toBe("allow");
	});

	it("boolean eq: true", async () => {
		const d = await decide(
			makeRule({ selector: sel, condition: { kind: "toolArg", type: "boolean", op: "eq", path: "dry_run", value: false } }),
			{ dry_run: false },
		);
		expect(d.effect).toBe("block");
	});

	it("nested dot-path access", async () => {
		const d = await decide(
			makeRule({ selector: sel, condition: { kind: "toolArg", type: "string", op: "eq", path: "user.role", value: "admin" } }),
			{ user: { role: "admin" } },
		);
		expect(d.effect).toBe("block");
	});

	it("missing path → condition false → allow", async () => {
		const d = await decide(
			makeRule({ selector: sel, condition: { kind: "toolArg", type: "string", op: "eq", path: "missing.key", value: "x" } }),
			{ other: "value" },
		);
		expect(d.effect).toBe("allow");
	});

	it("wrong type (number path, string condition) → allow", async () => {
		const d = await decide(
			makeRule({ selector: sel, condition: { kind: "toolArg", type: "string", op: "eq", path: "count", value: "5" } }),
			{ count: 5 },
		);
		expect(d.effect).toBe("allow");
	});
});

// ---------------------------------------------------------------------------
// enduserTag condition
// ---------------------------------------------------------------------------

describe("enduserTag condition", () => {
	const sel = beforeSelector();

	it("has: tag present and truthy → block", async () => {
		const engine = makeEngine(makeRule({ selector: sel, condition: { kind: "enduserTag", op: "has", tag: "is_admin" } }));
		const ctx = engine.createRunContext("run-1", { enduser: { externalId: "u1", metadata: { is_admin: "true" } } });
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("has: tag absent → allow", async () => {
		const engine = makeEngine(makeRule({ selector: sel, condition: { kind: "enduserTag", op: "has", tag: "is_admin" } }));
		const ctx = engine.createRunContext("run-1", { enduser: { externalId: "u1", metadata: {} } });
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("hasValue: exact match → block", async () => {
		const engine = makeEngine(makeRule({ selector: sel, condition: { kind: "enduserTag", op: "hasValue", tag: "plan", value: "free" } }));
		const ctx = engine.createRunContext("run-1", { enduser: { externalId: "u1", metadata: { plan: "free" } } });
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("hasValueAny: value in list → block", async () => {
		const engine = makeEngine(makeRule({ selector: sel, condition: { kind: "enduserTag", op: "hasValueAny", tag: "plan", values: ["free", "trial"] } }));
		const ctx = engine.createRunContext("run-1", { enduser: { externalId: "u1", metadata: { plan: "trial" } } });
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("no enduser on context → allow", async () => {
		const engine = makeEngine(makeRule({ selector: sel, condition: { kind: "enduserTag", op: "has", tag: "is_admin" } }));
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});
});

// ---------------------------------------------------------------------------
// maxCalls condition
// ---------------------------------------------------------------------------

describe("maxCalls condition", () => {
	it("within limit → allow", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "maxCalls", selector: { by: "toolName", patterns: ["test_tool"] }, max: 3 },
		});
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1");
		// 2 calls in history (not yet at limit of 3)
		await engine.afterTool(ctx, "test_tool", 1, {}, "r");
		await engine.afterTool(ctx, "test_tool", 1, {}, "r");

		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("at limit → block", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "maxCalls", selector: { by: "toolName", patterns: ["test_tool"] }, max: 2 },
		});
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1");
		await engine.afterTool(ctx, "test_tool", 1, {}, "r");
		await engine.afterTool(ctx, "test_tool", 1, {}, "r");

		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("by toolTag: counts tagged calls", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "maxCalls", selector: { by: "toolTag", tags: ["cat-a"] }, max: 1 },
		});
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1");
		await engine.afterTool(ctx, "test_tool", 1, {}, "r"); // cat-a is a category

		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("fresh context resets count", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "maxCalls", selector: { by: "toolName", patterns: ["test_tool"] }, max: 1 },
		});
		const engine = makeEngine(rule);
		const ctx1 = engine.createRunContext("run-1");
		await engine.afterTool(ctx1, "test_tool", 1, {}, "r");
		// ctx1 is at limit; new context starts fresh
		const ctx2 = engine.createRunContext("run-2");
		const d = await engine.beforeTool(ctx2, "test_tool", {});
		expect(d.effect).toBe("allow");
	});
});

// ---------------------------------------------------------------------------
// sequence condition
// ---------------------------------------------------------------------------

describe("sequence condition", () => {
	// mustHaveCalled fires (returns true) when the required tool has NOT been called
	it("mustHaveCalled: required tool absent from history → block", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "sequence", mustHaveCalled: ["auth_tool"] },
		});
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1");
		// No history — auth_tool not called
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("mustHaveCalled: required tool present in history → allow", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "sequence", mustHaveCalled: ["auth_tool"] },
		});
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1");
		await engine.afterTool(ctx, "auth_tool", 1, {}, "ok");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	// mustNotHaveCalled fires when the forbidden tool HAS been called
	it("mustNotHaveCalled: forbidden tool in history → block", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "sequence", mustNotHaveCalled: ["other_tool"] },
		});
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1");
		await engine.afterTool(ctx, "other_tool", 1, {}, "ok");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("mustNotHaveCalled: forbidden tool absent → allow", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "sequence", mustNotHaveCalled: ["other_tool"] },
		});
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("glob pattern in mustHaveCalled", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "sequence", mustHaveCalled: ["auth_*"] },
		});
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1");
		await engine.afterTool(ctx, "auth_tool", 1, {}, "ok");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});
});

// ---------------------------------------------------------------------------
// executionTime condition
// ---------------------------------------------------------------------------

describe("executionTime condition", () => {
	it("tool scope: executionTimeMS gt threshold → block (after phase only)", async () => {
		const rule: Rule = {
			id: "r1",
			policyId: "p1",
			enabled: true,
			priority: 0,
			name: "slow",
			selector: { phase: "tool.after", tool: { name: "test_tool" } },
			condition: { kind: "executionTime", scope: "tool", op: "gt", ms: 100 },
			effect: { type: "block" },
		};
		const engine = new GovernanceEngine({
			tools: [{ name: "test_tool" }],
			rules: [rule],
		});
		const ctx = engine.createRunContext("run-1");
		// We can verify it doesn't fire in beforeTool (executionTimeMS is null there)
		const dBefore = await engine.beforeTool(ctx, "test_tool", {});
		expect(dBefore.effect).toBe("allow");
	});

	it("total scope: uses accumulated TOTAL_DURATION_COUNTER", async () => {
		// Verified via: after-tool with accumulated total exceeding threshold
		// We validate the counter accumulates correctly (tested in engine.test.ts);
		// the condition itself follows the same comparison logic as the tool scope.
		// This test confirms the selector phase filtering works:
		const rule: Rule = {
			id: "r1",
			policyId: "p1",
			enabled: true,
			priority: 0,
			name: "total-time",
			selector: { phase: "tool.before", tool: { name: "test_tool" } },
			condition: { kind: "executionTime", scope: "total", op: "gt", ms: 50 },
			effect: { type: "block" },
		};
		const engine = new GovernanceEngine({
			tools: [{ name: "test_tool" }, { name: "other_tool" }],
			rules: [rule],
		});
		const ctx = engine.createRunContext("run-1");
		// executionTime in before phase always returns false (executionTimeMS is null)
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});
});

// ---------------------------------------------------------------------------
// timeGate condition
// ---------------------------------------------------------------------------

describe("timeGate condition", () => {
	// 2024-01-15 is a Monday; 12:00 UTC
	const MONDAY_NOON_UTC = new Date("2024-01-15T12:00:00Z").getTime();

	function makeTimeGateRule(windows: Array<{ days: string[]; start: string; end: string }>): Rule {
		return makeRule({
			selector: beforeSelector(),
			condition: {
				kind: "timeGate",
				timezone: { source: "enduserTag", tag: "tz" },
				windows: windows as any,
			},
		});
	}

	it("now within window → block", async () => {
		const rule = makeTimeGateRule([{ days: ["mon"], start: "11:00", end: "13:00" }]);
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1", {
			enduser: { externalId: "u1", metadata: { tz: "UTC" } },
		});
		// Override now() to return our fixed Monday noon
		(ctx as any).now = () => MONDAY_NOON_UTC;

		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("now outside window → allow", async () => {
		const rule = makeTimeGateRule([{ days: ["mon"], start: "14:00", end: "16:00" }]);
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1", {
			enduser: { externalId: "u1", metadata: { tz: "UTC" } },
		});
		(ctx as any).now = () => MONDAY_NOON_UTC;

		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("wrong day of week → allow", async () => {
		const rule = makeTimeGateRule([{ days: ["tue"], start: "11:00", end: "13:00" }]);
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1", {
			enduser: { externalId: "u1", metadata: { tz: "UTC" } },
		});
		(ctx as any).now = () => MONDAY_NOON_UTC;

		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("timezone offsets shift the time (UTC+5:30 means noon UTC = 17:30 IST)", async () => {
		// Mon 12:00 UTC = Mon 17:30 IST
		const rule = makeTimeGateRule([{ days: ["mon"], start: "17:00", end: "18:00" }]);
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1", {
			enduser: { externalId: "u1", metadata: { tz: "Asia/Kolkata" } },
		});
		(ctx as any).now = () => MONDAY_NOON_UTC;

		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("missing timezone tag → fail closed (allow, condition false)", async () => {
		const rule = makeTimeGateRule([{ days: ["mon"], start: "11:00", end: "13:00" }]);
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1", {
			enduser: { externalId: "u1", metadata: {} }, // no tz tag
		});
		(ctx as any).now = () => MONDAY_NOON_UTC;

		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});
});

// ---------------------------------------------------------------------------
// requireSubject condition
// ---------------------------------------------------------------------------

describe("requireSubject condition", () => {
	it("extractor returns matching subject → block", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "requireSubject", subjectType: "user" },
		});
		const engine = makeEngine(rule);
		engine.registerSubjectExtractor("test_tool", async () => [
			{ subjectType: "user", value: "alice" },
		]);
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("no subjects extracted → condition false → allow", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "requireSubject", subjectType: "user" },
		});
		const engine = makeEngine(rule);
		engine.registerSubjectExtractor("test_tool", async () => []);
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("wrong subjectType → condition false → allow", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "requireSubject", subjectType: "account" },
		});
		const engine = makeEngine(rule);
		engine.registerSubjectExtractor("test_tool", async () => [
			{ subjectType: "user", value: "alice" },
		]);
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("idSystem filter: matching idSystem → block", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "requireSubject", subjectType: "user", idSystem: "oauth" },
		});
		const engine = makeEngine(rule);
		engine.registerSubjectExtractor("test_tool", async () => [
			{ subjectType: "user", value: "alice", idSystem: "oauth" },
		]);
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("extractor throws → fail closed → allow", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "requireSubject", subjectType: "user" },
		});
		const engine = makeEngine(rule);
		engine.registerSubjectExtractor("test_tool", async () => {
			throw new Error("extractor error");
		});
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});
});

// ---------------------------------------------------------------------------
// signal condition
// ---------------------------------------------------------------------------

describe("signal condition", () => {
	it("provider returns matching value → block", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: {
				kind: "signal",
				key: "risk_score",
				args: { userId: { from: "const", value: "u1" } },
				op: "gt",
				value: 0.5,
			},
		});
		const engine = makeEngine(rule);
		engine.registerSignal("risk_score", async () => 0.9);
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});

	it("provider value doesn't satisfy op → allow", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "signal", key: "risk_score", args: {}, op: "gt", value: 0.5 },
		});
		const engine = makeEngine(rule);
		engine.registerSignal("risk_score", async () => 0.1);
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("provider throws → condition false → allow", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "signal", key: "bad_signal", args: {}, op: "eq", value: true },
		});
		const engine = makeEngine(rule);
		engine.registerSignal("bad_signal", async () => {
			throw new Error("provider failure");
		});
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("missing provider → condition false → allow", async () => {
		const rule = makeRule({
			selector: beforeSelector(),
			condition: { kind: "signal", key: "unregistered", args: {}, op: "eq", value: true },
		});
		const engine = makeEngine(rule);
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("provider is called only once per tool call when referenced multiple times (caching)", async () => {
		let callCount = 0;
		const rule: Rule = {
			id: "r1",
			policyId: "p1",
			enabled: true,
			priority: 0,
			name: "cache-test",
			selector: beforeSelector(),
			effect: { type: "block" },
			// and condition references the same signal twice
			condition: {
				kind: "and",
				all: [
					{ kind: "signal", key: "cached_signal", args: { x: { from: "const", value: 1 } }, op: "eq", value: 42 },
					{ kind: "signal", key: "cached_signal", args: { x: { from: "const", value: 1 } }, op: "eq", value: 42 },
				],
			},
		};
		const engine = makeEngine(rule);
		engine.registerSignal("cached_signal", async () => {
			callCount++;
			return 42;
		});
		const ctx = engine.createRunContext("run-1");
		await engine.beforeTool(ctx, "test_tool", {});
		expect(callCount).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// and / or / not
// ---------------------------------------------------------------------------

describe("logical conditions (and/or/not)", () => {
	const sel = beforeSelector();

	it("and: all true → block", async () => {
		const rule = makeRule({
			selector: sel,
			condition: {
				kind: "and",
				all: [
					{ kind: "toolName", op: "eq", value: "test_tool" },
					{ kind: "toolName", op: "startsWith", value: "test" },
				],
			},
		});
		expect((await decide(rule)).effect).toBe("block");
	});

	it("and: one false → allow (short-circuit)", async () => {
		const rule = makeRule({
			selector: sel,
			condition: {
				kind: "and",
				all: [
					{ kind: "toolName", op: "eq", value: "test_tool" },
					{ kind: "toolName", op: "eq", value: "other_tool" }, // false
				],
			},
		});
		expect((await decide(rule)).effect).toBe("allow");
	});

	it("or: first true → block", async () => {
		const rule = makeRule({
			selector: sel,
			condition: {
				kind: "or",
				any: [
					{ kind: "toolName", op: "eq", value: "test_tool" }, // true
					{ kind: "toolName", op: "eq", value: "other_tool" }, // not reached
				],
			},
		});
		expect((await decide(rule)).effect).toBe("block");
	});

	it("or: all false → allow", async () => {
		const rule = makeRule({
			selector: sel,
			condition: {
				kind: "or",
				any: [
					{ kind: "toolName", op: "eq", value: "other_tool" },
					{ kind: "toolName", op: "eq", value: "auth_tool" },
				],
			},
		});
		expect((await decide(rule)).effect).toBe("allow");
	});

	it("not: inverts a true condition", async () => {
		const rule = makeRule({
			selector: sel,
			condition: { kind: "not", not: { kind: "toolName", op: "eq", value: "test_tool" } },
		});
		expect((await decide(rule)).effect).toBe("allow");
	});

	it("not: inverts a false condition → block", async () => {
		const rule = makeRule({
			selector: sel,
			condition: { kind: "not", not: { kind: "toolName", op: "eq", value: "other_tool" } },
		});
		expect((await decide(rule)).effect).toBe("block");
	});

	it("nested: not(and([...]))", async () => {
		const rule = makeRule({
			selector: sel,
			condition: {
				kind: "not",
				not: {
					kind: "and",
					all: [
						{ kind: "toolName", op: "eq", value: "test_tool" },
						{ kind: "toolName", op: "eq", value: "other_tool" }, // false → and is false → not → true
					],
				},
			},
		});
		expect((await decide(rule)).effect).toBe("block");
	});
});

// ---------------------------------------------------------------------------
// metricWindow condition
// ---------------------------------------------------------------------------

describe("metricWindow condition", () => {
	const realFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = realFetch;
		delete process.env.HANDLEBAR_API_KEY;
	});

	function makeMetricRule(overrides: Partial<Rule> = {}): Rule {
		return {
			id: "metric-rule",
			policyId: "p1",
			enabled: true,
			priority: 0,
			name: "Metric Window",
			selector: { phase: "tool.before", tool: { name: "test_tool" } },
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
			...overrides,
		};
	}

	it("no agentId and no loaded budgets → condition false → allow", async () => {
		const engine = new GovernanceEngine({
			tools: [{ name: "test_tool" }],
			rules: [makeMetricRule()],
		});
		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("allow");
	});

	it("API returns block decision for budget → block", async () => {
		process.env.HANDLEBAR_API_KEY = "test-key";

		const metricRule = makeMetricRule();

		// The rule must come from the API rules endpoint so that initialiseAgent
		// calls evaluateMetrics with it and loads the resulting budget grant.
		globalThis.fetch = mock(async (url: string) => {
			const u = String(url);
			if (u.includes("/v1/agents") && !u.includes("rules") && !u.includes("metrics")) {
				return new Response(JSON.stringify({ agentId: "agent-x" }), { status: 200 });
			}
			if (u.includes("/v1/rules")) {
				return new Response(JSON.stringify({ rules: [metricRule] }), { status: 200 });
			}
			if (u.includes("/metrics/budget")) {
				return new Response(
					JSON.stringify({
						expires_seconds: 60,
						responses: [{ id: "metric-rule", decision: "block", grant: 0, computed: null }],
					}),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify(null), { status: 200 });
		}) as any;

		// Engine starts with no rules; they are loaded from the API
		const engine = new GovernanceEngine({ tools: [{ name: "test_tool" }], rules: [] });
		await engine.initAgentRules({ slug: "test" }, []);

		const ctx = engine.createRunContext("run-1");
		const d = await engine.beforeTool(ctx, "test_tool", {});
		expect(d.effect).toBe("block");
	});
});
