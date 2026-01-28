import { z } from "zod";
import { type JSONValue, JSONValueSchema } from "./common";
import { type RuleEffectKind, RuleEffectKindSchema } from "./effects";

export const RequireSubjectConditionSchema = z
  .object({
    kind: z.literal("requireSubject"),
    subjectType: z.string().min(1),
    idSystem: z.string().min(1).optional(),
  })
  .strict();
export type RequireSubjectCondition = z.infer<typeof RequireSubjectConditionSchema>;

export const SignalBindingSchema = z.discriminatedUnion("from", [
  z.object({ from: z.literal("enduserId") }).strict(),
  z.object({ from: z.literal("enduserTag"), tag: z.string().min(1) }).strict(),
  z.object({ from: z.literal("toolName") }).strict(),
  z.object({ from: z.literal("toolTag"), tag: z.string().min(1) }).strict(),
  z.object({ from: z.literal("toolArg"), path: z.string().min(1) }).strict(), // dot-path, validated elsewhere if you want
  z
    .object({
      from: z.literal("subject"),
      subjectType: z.string().min(1),
      role: z.string().min(1).optional(),
      field: z.enum(["id", "idSystem"]).optional(),
    })
    .strict(),
  z.object({ from: z.literal("const"), value: JSONValueSchema }).strict(),
]);
export type SignalBinding = z.infer<typeof SignalBindingSchema>;

export const SignalConditionSchema = z
  .object({
    kind: z.literal("signal"),
    key: z.string().min(1),
    args: z.record(z.string().min(1), SignalBindingSchema),
    op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin"]),
    value: JSONValueSchema,
    onMissing: RuleEffectKindSchema.optional(),
  })
  .strict();
export type SignalCondition = z.infer<typeof SignalConditionSchema>;
