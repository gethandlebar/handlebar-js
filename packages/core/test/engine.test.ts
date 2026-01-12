import { describe, expect, it } from "bun:test";
import type { Rule } from "@handlebar/governance-schema";
import { GovernanceEngine } from "../src/engine";
import type { RunContext, Tool } from "../src/types";

const tools: Tool[] = [
	{
		name: "listTickets",
		categories: [],
	},
];

function makeRunContext(): RunContext {
	return {
		runId: "12345",
		userCategory: "unknown",
		counters: {},
		history: [],
		stepIndex: 1,
		now: () => Date.now(),
		state: new Map(),
	};
}

const blockRule = (action: "block" | "allow"): Rule => ({
	id: "rule_01kc93yscvfb6bmg6kebdagmgp",
	policy_id: "plc_01kc906b2efsz9x12ybs7839mp",
	priority: 0,
	when: "pre",
	condition: { op: "eq", kind: "toolName", value: "listTickets" },
	actions: [{ type: action }],
});

describe("decideByRules - PRE", () => {
	it("Should decide tool name exact match as block", async () => {
		const engine = new GovernanceEngine({
			tools,
			defaultUncategorised: "allow",
			rules: [blockRule("block")],
		});

		const result = await engine.decideByRules(
			"pre",
			makeRunContext(),
			{ args: {}, tool: { name: "listTickets" } },
			100,
		);
		expect(result).toEqual({
			code: "BLOCKED_RULE",
			effect: "block",
			matchedRuleIds: ["rule_01kc93yscvfb6bmg6kebdagmgp"],
			appliedActions: [
				{ type: "block", ruleId: "rule_01kc93yscvfb6bmg6kebdagmgp" },
			],
		});
	});

	it("Should decide tool name exact match as allow", async () => {
		const engine = new GovernanceEngine({
			tools,
			defaultUncategorised: "allow",
			rules: [blockRule("allow")],
		});

		const result = await engine.decideByRules(
			"pre",
			makeRunContext(),
			{ args: {}, tool: { name: "listTickets" } },
			100,
		);
		expect(result).toEqual({
			code: "ALLOWED",
			effect: "allow",
			matchedRuleIds: ["rule_01kc93yscvfb6bmg6kebdagmgp"],
			appliedActions: [
				{ type: "allow", ruleId: "rule_01kc93yscvfb6bmg6kebdagmgp" },
			],
		});
	});
});

describe("Rule evals - enduser rule", () => {
	it("Should eval false if enduser is undefined for 'has' op", () => {
		const engine = new GovernanceEngine({
			tools: [],
			defaultUncategorised: "allow",
		});

		const result = engine.evalEnduserTag(
			{
				kind: "enduserTag",
				tag: "sometag",
				op: "has",
			},
			undefined,
		);

		expect(result).toBe(false);
	});

	it("Should eval false if enduser is undefined for 'hasValue' op", () => {
		const engine = new GovernanceEngine({
			tools: [],
			defaultUncategorised: "allow",
		});

		const result = engine.evalEnduserTag(
			{
				kind: "enduserTag",
				tag: "sometag",
				op: "hasValue",
				value: "any",
			},
			undefined,
		);

		expect(result).toBe(false);
	});

	it("Should eval false if tag does not exist in 'has' op", () => {
		const engine = new GovernanceEngine({
			tools: [],
			defaultUncategorised: "allow",
		});

		const result = engine.evalEnduserTag(
			{
				kind: "enduserTag",
				op: "has",
				tag: "sometag",
			},
			{ externalId: "123", metadata: { anothertag: "5" } },
		);

		expect(result).toBe(false);
	});

	it("Should eval false if tag does not exist in 'hasValue' op", () => {
		const engine = new GovernanceEngine({
			tools: [],
			defaultUncategorised: "allow",
		});

		const result = engine.evalEnduserTag(
			{
				kind: "enduserTag",
				op: "hasValue",
				tag: "sometag",
				value: "any",
			},
			{ externalId: "123", metadata: { anothertag: "5" } },
		);

		expect(result).toBe(false);
	});

	it("Should eval tag existence with case sensitivity", () => {
		const engine = new GovernanceEngine({
			tools: [],
			defaultUncategorised: "allow",
		});

		const result = engine.evalEnduserTag(
			{
				kind: "enduserTag",
				op: "has",
				tag: "sometag",
			},
			{ externalId: "123", metadata: { sOmETaG: "true" } },
		);

		expect(result).toBe(false);
	});

	// string of "false" is truthy
	it.each(["1", "5", "avalue", "true", "True", "false"])(
		"Should eval true for 'has' op if tag value is truthy",
		(value: string) => {
			const engine = new GovernanceEngine({
				tools: [],
				defaultUncategorised: "allow",
			});

			const result = engine.evalEnduserTag(
				{
					kind: "enduserTag",
					op: "has",
					tag: "sometag",
				},
				{ externalId: "123", metadata: { sometag: value } },
			);

			expect(result).toBe(true);
		},
	);

	// N.B. enduser conditions don't accept boolean or numeric values yet
	it.each([""])(
		"Should eval false for 'has' op if tag value is falsy",
		(value: string) => {
			const engine = new GovernanceEngine({
				tools: [],
				defaultUncategorised: "allow",
			});

			const result = engine.evalEnduserTag(
				{
					kind: "enduserTag",
					op: "has",
					tag: "sometag",
				},
				{ externalId: "123", metadata: { sometag: value } },
			);

			expect(result).toBe(false);
		},
	);

	it.each(["somevalue", "any", "!", "false"])(
		"Should eval true for 'hasValue' op if tag value matches expected exactly",
		(value: string) => {
			const engine = new GovernanceEngine({
				tools: [],
				defaultUncategorised: "allow",
			});

			const result = engine.evalEnduserTag(
				{
					kind: "enduserTag",
					op: "hasValue",
					tag: "sometag",
					value,
				},
				{ externalId: "123", metadata: { sometag: value } },
			);

			expect(result).toBe(true);
		},
	);

	it("Should eval true for 'hasValue' op with empty string tag value", () => {
		const engine = new GovernanceEngine({
			tools: [],
			defaultUncategorised: "allow",
		});

		const result = engine.evalEnduserTag(
			{
				kind: "enduserTag",
				op: "hasValue",
				tag: "sometag",
				value: "", // empty string should be a value expected value for the tag.
			},
			{ externalId: "123", metadata: { sometag: "" } },
		);

		expect(result).toBe(true);
	});

	it("Should eval false for 'hasValue' op if case variance in value", () => {
		const engine = new GovernanceEngine({
			tools: [],
			defaultUncategorised: "allow",
		});

		const result = engine.evalEnduserTag(
			{
				kind: "enduserTag",
				op: "hasValue",
				tag: "sometag",
				value: "avalue",
			},
			{ externalId: "123", metadata: { sometag: "aValue" } },
		);

		expect(result).toBe(false);
	});

	it.each(["", "!", "_", "!avalue", " avalue"])(
		"Should eval false for 'hasValue' op if values don't match",
		(actualValue: string) => {
			const engine = new GovernanceEngine({
				tools: [],
				defaultUncategorised: "allow",
			});

			const result = engine.evalEnduserTag(
				{
					kind: "enduserTag",
					op: "hasValue",
					tag: "sometag",
					value: actualValue,
				},
				{ externalId: "123", metadata: { sometag: "avalue" } },
			);

			expect(result).toBe(false);
		},
	);
});
