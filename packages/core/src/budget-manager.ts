import type { BudgetGrant } from "./api/types";

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

  public useRuleBudget(ruleMetricUpdates: Map<string, number>): void {
    const newBudgets: BudgetGrant[] = [];
    for (const budget of this.budgets) {
      const grantUsage = ruleMetricUpdates.get(budget.id);
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
    const timeUntilNextEvaluation = this.globalTtlSeconds * 1000 - timeSinceLastEvaluation;
    this.lastEvaluatedMs = evaluationTime;

    if (timeUntilNextEvaluation <= 0) {
      // All need to be reevaluated on the server.
      return true
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
