import z from "zod";

export const RuleEffectKindSchema = z.enum(["allow", "hitl", "block"]);
export type RuleEffectKind = z.infer<typeof RuleEffectKindSchema>;

/**
 * Direct impact of a rule breach.
 *
 * RuleEffect has an immediate impact on the agent run/tool action.
 * This is in contract to side effects (yet to be defined),
 * which would include "log" or "modify context".
 */
export const RuleEffectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("allow"), reason: z.string().max(500).optional() }).strict(),
  z.object({ type: z.literal("hitl"), reason: z.string().max(500).optional() }).strict(),
  z.object({ type: z.literal("block"), reason: z.string().max(500).optional() }).strict(),
// Possible future expansions.
// | { type: "require_step"; toolName: string; withinSeconds?: number; reason?: string }
// | { type: "redact"; fields: string[]; reason?: string };
]);
export type RuleEffect = z.infer<typeof RuleEffectSchema>;
