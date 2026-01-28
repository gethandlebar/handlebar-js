import { z } from "zod";

const DaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Day = z.infer<typeof DaySchema>;

const TimeHHMMSchema = z
  .string()
  // 24h "HH:MM"
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected time in "HH:MM" 24-hour format');

export const TimeGateConditionSchema = z
  .object({
    kind: z.literal("timeGate"),
    timezone: z
      .object({
        source: z.literal("enduserTag"),
        tag: z.string().min(1),
        fallback: z.literal("org").optional(),
      })
      .strict(),
    windows: z
      .array(
        z
          .object({
            days: z.array(DaySchema).min(1),
            start: TimeHHMMSchema,
            end: TimeHHMMSchema,
          })
          .strict()
      )
      .min(1),
  })
  .strict();
export type TimeGateCondition = z.infer<typeof TimeGateConditionSchema>;

const ExecutionTimeScopeSchema = z.enum(["tool", "total"]);
export type ExecutionTimeScope = z.infer<typeof ExecutionTimeScopeSchema>;

export const ExecutionTimeConditionSchema = z
  .object({
    kind: z.literal("executionTime"),
    scope: ExecutionTimeScopeSchema,
    op: z.enum(["gt", "gte", "lt", "lte", "eq", "neq"]),
    ms: z.number().int().nonnegative(),
  })
  .strict();
export type ExecutionTimeCondition = z.infer<typeof ExecutionTimeConditionSchema>;
