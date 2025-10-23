import { describe, expect, it } from "bun:test";
import { Pred, RuleBuilder } from "../src/predicates";
import type { ToolCall } from "../src/types";

function createRunContextWithUserCategory(category: string) {
	return {
		runId: "1",
		userCategory: category,
		history: [],
		state: new Map(),
		counters: {},
		stepIndex: 1,
		now: () => Date.now(),
	};
}

function createEmptyToolCallObject(): ToolCall {
	return {
		tool: {
			name: "aTool",
			categories: [],
		},
		args: {},
	};
}

describe("Rule builder - basics", () => {
	it("should block if not defined", () => {
		const rule = new RuleBuilder("allow-pii-read-for-admin-dpo")
			.when(Pred.userIn(["admin"]))
			.build();

		expect(rule.effect).toBe("block");
	});

	it("should allow if defined in definition", () => {
		const rule = new RuleBuilder("allow-pii-read-for-admin-dpo")
			.when(Pred.userIn(["admin"]))
			.allow("with a reason")
			.build();

		expect(rule.effect).toBe("allow");
		expect(rule.reason).toBe("with a reason");
	});

	it("should throw error if no pred before build", () => {
		expect(() => new RuleBuilder("rule-should-throw").build()).toThrow();
	});
});

const userCategoryAllow = new RuleBuilder("user-allow")
	.when(Pred.userIs("admin"))
	.allow("")
	.build();
// const userCategoryBlock = new RuleBuilder("user-block")
// 	.when(Pred.userIs("admin"))
// 	.block()
// 	.build();

describe("Rule - Basic rule evaluation", () => {
	it("Should evaluate basic userIs allow rule to allow if user matches in run context", () => {
		const ctx = createRunContextWithUserCategory("admin");
		expect(
			userCategoryAllow.when.evaluate(ctx, createEmptyToolCallObject()),
		).toEqual(true);
	});

	it.each(["admin2", "unknown", "notadmin"])(
		"Should evaluate basic userIs allow rule to allow if user matches in run context",
		(category: string) => {
			const ctx = createRunContextWithUserCategory(category);
			expect(
				userCategoryAllow.when.evaluate(ctx, createEmptyToolCallObject()),
			).toEqual(false);
		},
	);
});
