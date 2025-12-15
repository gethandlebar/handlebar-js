import { describe, expect, it } from 'bun:test';
import type { Rule } from '@handlebar/governance-schema';
import { GovernanceEngine } from '../src/engine';
import type { RunContext, Tool } from '../src/types';

const tools: Tool[] = [
  {
    name: "listTickets",
    categories: []
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
  }
}

const blockRule = (action: "block" | "allow"): Rule => 	({
		id: "rule_01kc93yscvfb6bmg6kebdagmgp",
		policy_id: "plc_01kc906b2efsz9x12ybs7839mp",
		priority: 0,
		when: "pre",
		condition: { op: "eq", kind: "toolName", value: "listTickets" },
		actions: [{ type: action }],
	})

describe("decideByRules - PRE", () => {
  it("Should decide tool name exact match as block", async () => {
    const engine = new GovernanceEngine({ tools, defaultUncategorised: "allow", rules: [blockRule("block")] });

    const result = await engine.decideByRules("pre", makeRunContext(), { args: {}, tool: { name: "listTickets" } }, 100);
    expect(result).toEqual({ code: "BLOCKED_RULE", effect: "block", matchedRuleIds: ["rule_01kc93yscvfb6bmg6kebdagmgp"], appliedActions: [{ type: "block", ruleId: "rule_01kc93yscvfb6bmg6kebdagmgp" }] });
  });

  it("Should decide tool name exact match as allow", async () => {
    const engine = new GovernanceEngine({ tools, defaultUncategorised: "allow", rules: [blockRule("allow")] });

    const result = await engine.decideByRules("pre", makeRunContext(), { args: {}, tool: { name: "listTickets" } }, 100);
    expect(result).toEqual({ code: "ALLOWED", effect: "allow", matchedRuleIds: ["rule_01kc93yscvfb6bmg6kebdagmgp"], appliedActions: [{ type: "allow", ruleId: "rule_01kc93yscvfb6bmg6kebdagmgp" }] });
  });
})
