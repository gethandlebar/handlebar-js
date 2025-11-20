import z from "zod";
import type { RuleAction } from "./action.types";
import type { RuleCondition } from "./condition.types";

/**
 * Timing for rule evaluation relative to tool call lifecycle.
 * - pre: evaluate before the tool executes
 * - post: evaluate after the tool executes
 * - both: evaluate both pre and post
 */
export type RuleWhen = "pre" | "post" | "both";

/**
 * A single rule definition combining condition, actions, timing, and priority.
 * This can be stored as JSONB or constructed/transmitted over the wire.
 */
export const RuleConfigSchema = z.object({
  priority: z.number().min(0),
  when: z.custom<RuleWhen>(),
  condition: z.custom<RuleCondition>(),
  actions: z.array(z.custom<RuleAction>()),
});

/**
 * Rule object coming from API.
 */
export const RuleSchema = z.object({
  id: z.uuid({ version: "v7" }),
  policy_id: z.uuid({ version: "v7" }),
}).and(RuleConfigSchema);

export type RuleConfig = z.infer<typeof RuleConfigSchema>;
export type Rule = z.infer<typeof RuleSchema>;
