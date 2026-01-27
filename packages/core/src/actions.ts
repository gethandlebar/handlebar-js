import type { GovernanceDecision, RuleEffectKind } from "@handlebar/governance-schema";

export function effectRank(effect: RuleEffectKind): number {
  // higher = more severe
  if (effect === "block") return 3;
  if (effect === "hitl") return 2;
  return 1; // allow
}

export function decisionCodeFor(effect: RuleEffectKind): GovernanceDecision["code"] {
  switch (effect) {
    case "block":
      return "BLOCKED_RULE";
    case "hitl":
      return "BLOCKED_HITL_REQUESTED";
    default:
      return "ALLOWED";
  }
}
