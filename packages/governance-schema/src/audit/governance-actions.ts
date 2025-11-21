
export type GovernanceEffect = "allow" | "block";
export type GovernanceCode =
	| "BLOCKED_UNCATEGORISED"
	| "BLOCKED_RULE"
	| "BLOCKED_CUSTOM"
	| "ALLOWED"
	| "NO_OP";

export type GovernanceDecision = {
	effect: GovernanceEffect;

	/** which rules matched */
	matchedRuleIds: string[];

	/** which actions were applied (allow, block, notify, etc.) */
	appliedActions: AppliedAction[];

	/** any human-readable summary for logs */
	reason?: string;

	/** engine-internal code for telemetry */
	code: GovernanceCode;
};

export type AppliedAction = {
	type: "allow" | "block" | "notify" | "log" | "hitl";
	ruleId: string;
};
