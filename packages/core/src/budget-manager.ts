import z from "zod";

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

export class BudgetManager {
	private globalTtlSeconds: number;
	private lastEvaluatedMs: number;
	public budgets: BudgetGrant[];

	constructor(opts?: { globalTtlSeconds?: number; budgets?: BudgetGrant[] }) {
		this.globalTtlSeconds = opts?.globalTtlSeconds ?? 60;
		this.budgets = opts?.budgets ?? [];
		this.lastEvaluatedMs = Date.now();
	}

	public updateBudgets(ttlSeconds: number, newBudgets: BudgetGrant[]): void {
		this.budgets = newBudgets;
		this.globalTtlSeconds = ttlSeconds;
		this.lastEvaluatedMs = Date.now();
	}

	public usage(ruleMetricUpdates: Record<string, number>): void {
		const newBudgets: BudgetGrant[] = [];
		const metricMap = new Map(Object.entries(ruleMetricUpdates));

		for (const budget of this.budgets) {
			const grantUsage = metricMap.get(budget.id);
			let newBudget: BudgetGrant;

			if (budget.grant !== null && grantUsage !== undefined) {
				newBudget = { ...budget, grant: budget.grant - grantUsage };
			} else {
				newBudget = budget;
			}

			newBudgets.push(newBudget);
		}

		this.budgets = newBudgets;
	}

	public reevaluate(): boolean {
		const evaluationTime = Date.now();
		const timeSinceLastEvaluation = evaluationTime - this.lastEvaluatedMs;
		const timeUntilNextEvaluation =
			this.globalTtlSeconds * 1000 - timeSinceLastEvaluation;

		if (timeUntilNextEvaluation <= 0) {
			// All need to be reevaluated on the server.
			return true;
		}

		for (const budget of this.budgets) {
			if (budget.grant !== null && budget.grant <= 0) {
				// For now we'll reevaluate all budgets if any of them are potentially exhausted.
				// TODO: reevaluate failed subset only instead.
				return true;
			}
		}

		return false;
	}
}
