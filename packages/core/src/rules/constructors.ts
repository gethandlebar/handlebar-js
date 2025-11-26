import { randomUUID } from "node:crypto";
import type {
	Glob,
	JSONValue,
	Rule,
	RuleAction,
	RuleCondition,
	RuleConfig,
	RuleWhen,
} from "@handlebar/governance-schema";

export const and = (...all: RuleCondition[]): RuleCondition => ({
	kind: "and",
	all,
});

export const or = (...any: RuleCondition[]): RuleCondition => ({
	kind: "or",
	any,
});

export const not = (cond: RuleCondition): RuleCondition => ({
	kind: "not",
	not: cond,
});

export const toolName = {
	eq: (value: string | Glob): RuleCondition => ({
		kind: "toolName",
		op: "eq",
		value,
	}),
	neq: (value: string | Glob): RuleCondition => ({
		kind: "toolName",
		op: "neq",
		value,
	}),
	glob: (value: Glob): RuleCondition => ({
		kind: "toolName",
		op: "glob",
		value,
	}),
	in: (values: (string | Glob)[]): RuleCondition => ({
		kind: "toolName",
		op: "in",
		value: values,
	}),
	startsWith: (value: string): RuleCondition => ({
		kind: "toolName",
		op: "startsWith",
		value,
	}),
	endsWith: (value: string): RuleCondition => ({
		kind: "toolName",
		op: "endsWith",
		value,
	}),
	contains: (value: string): RuleCondition => ({
		kind: "toolName",
		op: "contains",
		value,
	}),
};

export const toolTag = {
	has: (tag: string): RuleCondition => ({
		kind: "toolTag",
		op: "has",
		tag,
	}),
	anyOf: (tags: string[]): RuleCondition => ({
		kind: "toolTag",
		op: "anyOf",
		tags,
	}),
	allOf: (tags: string[]): RuleCondition => ({
		kind: "toolTag",
		op: "allOf",
		tags,
	}),
};

export const execTime = {
	gt: (scope: "tool" | "total", ms: number): RuleCondition => ({
		kind: "executionTime",
		scope,
		op: "gt",
		ms,
	}),
	gte: (scope: "tool" | "total", ms: number): RuleCondition => ({
		kind: "executionTime",
		scope,
		op: "gte",
		ms,
	}),
	lt: (scope: "tool" | "total", ms: number): RuleCondition => ({
		kind: "executionTime",
		scope,
		op: "lt",
		ms,
	}),
	lte: (scope: "tool" | "total", ms: number): RuleCondition => ({
		kind: "executionTime",
		scope,
		op: "lte",
		ms,
	}),
};

export const sequence = (opts: {
	mustHaveCalled?: Glob[];
	mustNotHaveCalled?: Glob[];
}): RuleCondition => ({
	kind: "sequence",
	...opts,
});

export const maxCalls = (opts: {
	selector:
		| { by: "toolName"; patterns: Glob[] }
		| { by: "toolTag"; tags: string[] };
	max: number;
}): RuleCondition => ({
	kind: "maxCalls",
	selector: opts.selector,
	max: opts.max,
});

export const custom = (name: string, args?: JSONValue): RuleCondition => ({
	kind: "custom",
	name,
	args,
});

export const block = (): RuleAction => ({ type: "block" });
export const allow = (): RuleAction => ({ type: "allow" });

type BaseRuleInput = {
	priority: number;
	if: RuleCondition;
	do: RuleAction[];
};

export const rule = Object.assign(
	(when: RuleWhen, input: BaseRuleInput): RuleConfig => ({
		priority: input.priority,
		when,
		condition: input.if,
		actions: input.do,
	}),
	{
		pre: (input: BaseRuleInput): RuleConfig => rule("pre", input),
		post: (input: BaseRuleInput): RuleConfig => rule("post", input),
		both: (input: BaseRuleInput): RuleConfig => rule("both", input),
	},
);

export function configToRule(config: RuleConfig): Rule {
	return {
		id: `usr-rule-${randomUUID()}`,
		policy_id: `usr-rule-${randomUUID()}`,
		...config,
	};
}
