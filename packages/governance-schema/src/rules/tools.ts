import { z } from "zod";
import { GlobSchema } from "./common";

export const ToolNameConditionSchema = z.discriminatedUnion("op", [
  z
    .object({
      kind: z.literal("toolName"),
      op: z.enum(["eq", "neq", "contains", "startsWith", "endsWith", "glob"]),
      value: z.string().min(1), // (string | Glob) == string at runtime
    })
    .strict(),
  z
    .object({
      kind: z.literal("toolName"),
      op: z.literal("in"),
      value: z.array(z.string().min(1)).min(1),
    })
    .strict(),
]);
export type ToolNameCondition = z.infer<typeof ToolNameConditionSchema>;

export const ToolTagConditionSchema = z.discriminatedUnion("op", [
  z.object({ kind: z.literal("toolTag"), op: z.literal("has"), tag: z.string().min(1) }).strict(),
  z
    .object({ kind: z.literal("toolTag"), op: z.literal("anyOf"), tags: z.array(z.string().min(1)).min(1) })
    .strict(),
  z
    .object({ kind: z.literal("toolTag"), op: z.literal("allOf"), tags: z.array(z.string().min(1)).min(1) })
    .strict(),
]);
export type ToolTagCondition = z.infer<typeof ToolTagConditionSchema>;

export const SequenceConditionSchema = z
  .object({
    kind: z.literal("sequence"),
    mustHaveCalled: z.array(GlobSchema).min(1).optional(),
    mustNotHaveCalled: z.array(GlobSchema).min(1).optional(),
  })
  .strict()
  .refine(
    (v) => v.mustHaveCalled?.length || v.mustNotHaveCalled?.length,
    "sequence requires mustHaveCalled and/or mustNotHaveCalled"
  );
export type SequenceCondition = z.infer<typeof SequenceConditionSchema>;

export const MaxCallsSelectorSchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("toolName"), patterns: z.array(GlobSchema).min(1) }).strict(),
  z.object({ by: z.literal("toolTag"), tags: z.array(z.string().min(1)).min(1) }).strict(),
]);
export type MaxCallsSelector = z.infer<typeof MaxCallsSelectorSchema>;

export const MaxCallsConditionSchema = z
  .object({
    kind: z.literal("maxCalls"),
    selector: MaxCallsSelectorSchema,
    max: z.number().int().nonnegative(),
  })
  .strict();
export type MaxCallsCondition = z.infer<typeof MaxCallsConditionSchema>;
