import z from "zod";

export type ApiConfig = {
	apiEndpoint?: string;
	apiKey?: string;
};

export type AgentTool = {
	name: string;
	key: string;
	version: number;
	kind: "function";

	description?: string;
	metadata?: Record<string, string>;
};

const AggregateTypes = z.enum(["sum", "avg", "count", "max", "min"]);

export const MetricBudgetRequest = z.object({
	id: z.string(),
	budget_request: z.number().min(1),
	budget: z.number().min(1),
	scope: z.enum(["agent", "agent_user"]),
	aggregate: AggregateTypes,
	op: z.enum(["eq", "neq", "lt", "lte", "gt", "gte"]),
	time_window_seconds: z
		.number()
		.min(1)
		.max(60 * 60 * 24 * 365), // 1 Year. Arbitrary "extreme" cap.
	metric: z.string(),
});

export const BudgetGrantSchema = z.object({
	id: z.string(),
	decision: z.enum(["allow", "block", "defer"]),
	expires_seconds: z.number().min(1).optional(),
	grant: z.number().nullable(),
	computed: z.object({ kind: AggregateTypes, value: z.number() }).nullable(),
});
export type BudgetGrant = z.infer<typeof BudgetGrantSchema>;

export const BudgetGrantResponseSchema = z.object({
	expires_seconds: z.number().min(1),
	responses: z.array(BudgetGrantSchema),
});
export type BudgetGrantResponse = z.infer<typeof BudgetGrantResponseSchema>;
