import type { Glob } from "./common";
import type { RuleCondition } from "./condition";
import type { RuleEffect, RuleEffectKind } from "./effects";

export type RulePhase = "tool.before" | "tool.after";

export type RuleSelector = {
	phase: RulePhase;
	tool?: {
		name?: Glob | Glob[];
		tagsAll?: string[];
		tagsAny?: string[];
		// Expand to other tool metadata when we have more well-defined types.
		// actionClass?: "read" | "write" | "execute" | "send";
		// audienceClass?: "internal" | "user" | "external";
	};
	// optional extension, but we should prefer policy-level
	// agent?: { anyOfSlugs?: string[]; anyOfTags?: string[]; allOfTags?: string[] };
};

export type Rule = {
	id: string;
	policyId: string;
	enabled: boolean;
	priority: number;
	name: string;

	selector: RuleSelector; // Cheap gating for rule applicability.
	condition: RuleCondition; // Full logic for evaluation. Should NOT include selector logic.

	// Only a single canonical effect to influence agent behaviour immediately post-breach.
	// TODO: support multiple side-effects in addition to primary "effect".
	effect: RuleEffect;

	onMissing?: RuleEffectKind; // default block.
};
