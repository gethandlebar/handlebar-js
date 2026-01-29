import z from "zod";

export const GlobSchema = z
	.string()
	.min(1)
	.describe("A case-insensitive glob pattern");
export type Glob = z.infer<typeof GlobSchema>;

/**
 * JSON-safe value for condition parameters and custom function args.
 */
const BaseJSONValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const JSONValueSchema = z.union([
	BaseJSONValue,
	z.array(BaseJSONValue),
	z.record(z.string(), BaseJSONValue),
]);
export type JSONValue = z.infer<typeof JSONValueSchema>;
