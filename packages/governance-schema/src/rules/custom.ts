import { z } from "zod";
import { JSONValueSchema } from "./common";

/**
 * Delegate condition evaluation to a user-defined function.
 * - `name` is resolved by the host SDK/application
 * - `args` is an opaque, JSON-serialisable payload consumed by user code
 */
 export const CustomFunctionConditionSchema = z
   .object({
     kind: z.literal("custom"),
     name: z.string().min(1),
     args: JSONValueSchema.optional(),
   })
   .strict();
 export type CustomFunctionCondition = z.infer<typeof CustomFunctionConditionSchema>;
