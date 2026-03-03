import { z } from "zod";
import { GlobSchema } from "./common";

// ---------------------------------------------------------------------------
// ToolNameCondition
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ToolArgCondition
//
// - path is optional on all typed variants (scan mode: when absent, all
//   string leaf values in the argument object are scanned)
// ---------------------------------------------------------------------------

export const ToolArgConditionSchema = z.union([
	z.discriminatedUnion("type", [
		z.object({
			kind: z.literal("toolArg"),
			type: z.literal("string"),
			op: z.enum([
				"eq",
				"neq",
				"contains",
				"startsWith",
				"endsWith",
				"in",
				"regex",
			]),
			path: z.string().min(1).max(100).optional(),
			value: z.string().min(1).max(1000),
		}),
		z.object({
			kind: z.literal("toolArg"),
			type: z.literal("number"),
			op: z.enum(["eq", "neq", "lt", "lte", "gt", "gte"]),
			path: z.string().min(1).max(100).optional(),
			value: z.number(),
		}),
		z.object({
			kind: z.literal("toolArg"),
			type: z.literal("boolean"),
			op: z.literal("eq"),
			path: z.string().min(1).max(100).optional(),
			value: z.boolean(),
		}),
	]),
	// Existence checks - type-agnostic, path required, no value field
	z
		.object({
			kind: z.literal("toolArg"),
			op: z.enum(["exists", "notExists"]),
			path: z.string().min(1).max(100),
		})
		.strict(),
]);
export type ToolArgCondition = z.infer<typeof ToolArgConditionSchema>;

// ---------------------------------------------------------------------------
// ToolTagCondition
// ---------------------------------------------------------------------------

export const ToolTagConditionSchema = z.discriminatedUnion("op", [
	z
		.object({
			kind: z.literal("toolTag"),
			op: z.literal("has"),
			tag: z.string().min(1),
		})
		.strict(),
	z
		.object({
			kind: z.literal("toolTag"),
			op: z.literal("anyOf"),
			tags: z.array(z.string().min(1)).min(1),
		})
		.strict(),
	z
		.object({
			kind: z.literal("toolTag"),
			op: z.literal("allOf"),
			tags: z.array(z.string().min(1)).min(1),
		})
		.strict(),
]);
export type ToolTagCondition = z.infer<typeof ToolTagConditionSchema>;

// ---------------------------------------------------------------------------
// SequenceCondition
//
// - SequenceEntry can be:
//     • bare GlobSchema string (legacy, for backwards compat)
//     • { by: "toolName", patterns: Glob[] }  (named equivalent of the bare string)
//     • { by: "toolTag",  tags: string[], op?: "anyOf"|"allOf" }  (tag-based entry)
// ---------------------------------------------------------------------------

export const SequenceEntrySchema = z.union([
	GlobSchema, // legacy: bare glob string — keeps existing stored rules valid
	z
		.object({
			by: z.literal("toolName"),
			patterns: z.array(GlobSchema).min(1),
		})
		.strict(),
	z
		.object({
			by: z.literal("toolTag"),
			tags: z.array(z.string().min(1)).min(1),
			/** Defaults to "anyOf" when absent. */
			op: z.enum(["anyOf", "allOf"]).optional(),
		})
		.strict(),
]);
export type SequenceEntry = z.infer<typeof SequenceEntrySchema>;

export const SequenceConditionSchema = z
	.object({
		kind: z.literal("sequence"),
		mustHaveCalled: z.array(SequenceEntrySchema).min(1).optional(),
		mustNotHaveCalled: z.array(SequenceEntrySchema).min(1).optional(),
	})
	.strict()
	.refine(
		(v) => v.mustHaveCalled?.length || v.mustNotHaveCalled?.length,
		"sequence requires mustHaveCalled and/or mustNotHaveCalled",
	);
export type SequenceCondition = z.infer<typeof SequenceConditionSchema>;

// ---------------------------------------------------------------------------
// MaxCallsCondition
//
// - windowSeconds: optional look-back window; when absent, counts all calls
//   in the current scope (run for run-scoped, all-time for agent-scoped)
// - per: scope of the count - "agent" (all users, default) or "agent_user"
// - tagFilter: additional tag filter applied alongside selector (AND logic)
// ---------------------------------------------------------------------------

export const MaxCallsSelectorSchema = z.discriminatedUnion("by", [
	z
		.object({ by: z.literal("toolName"), patterns: z.array(GlobSchema).min(1) })
		.strict(),
	z
		.object({
			by: z.literal("toolTag"),
			tags: z.array(z.string().min(1)).min(1),
		})
		.strict(),
]);
export type MaxCallsSelector = z.infer<typeof MaxCallsSelectorSchema>;

export const MaxCallsConditionSchema = z
	.object({
		kind: z.literal("maxCalls"),
		selector: MaxCallsSelectorSchema,
		max: z.number().int().nonnegative(),
		/** Count only calls within the last N seconds. Omit to count all calls in scope. */
		windowSeconds: z.number().int().positive().optional(),
		/** Scope of the call count. Defaults to "agent" when absent. */
		per: z.enum(["agent", "agent_user"]).optional(),
		/** Extra tag filter applied alongside selector (AND). */
		tagFilter: z.array(z.string().min(1)).min(1).optional(),
	})
	.strict();
export type MaxCallsCondition = z.infer<typeof MaxCallsConditionSchema>;
