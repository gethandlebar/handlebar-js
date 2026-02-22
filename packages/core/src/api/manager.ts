import type { MetricWindowCondition, Rule } from "@handlebar/governance-schema";
import type z from "zod";
import {
	type AgentTool,
	type ApiConfig,
	type BudgetGrantResponse,
	BudgetGrantResponseSchema,
	type MetricBudgetRequest,
} from "./types";

type HitlResponse = {
	hitlId: string;
	status: "pending" | "approved" | "denied";
	pre_existing: boolean;
};

export class ApiManager {
	private useApi: boolean;
	private apiKey: string | undefined;
	private apiEndpoint: string;
	public agentId: string | undefined;

	constructor(config: ApiConfig, agentId?: string) {
		this.apiEndpoint =
			config.apiEndpoint ??
			process.env.HANDLEBAR_API_ENDPOINT ??
			"https://api.gethandlebar.com";
		this.apiKey = config.apiKey ?? process.env.HANDLEBAR_API_KEY;
		this.useApi = this.apiEndpoint !== undefined && this.apiKey !== undefined;
		this.agentId = agentId;
	}

	public async queryHitl(
		runId: string,
		ruleId: string,
		toolName: string,
		toolArgs: Record<string, unknown>,
	): Promise<HitlResponse | null> {
		if (!this.useApi || !this.agentId) {
			return null;
		}

		const url = new URL("/v1/audit/hitl", this.apiEndpoint);
		try {
			const response = await fetch(url.toString(), {
				method: "POST",
				headers: this.headers("json"),
				body: JSON.stringify({
					agentId: this.agentId,
					ruleId,
					runId,
					tool: { name: toolName, args: toolArgs },
				}),
			});

			if (!response.ok) {
				throw new Error(`Failed to query HITL status: ${response.status}`);
			}

			const data: HitlResponse = await response.json();
			return data;
		} catch (error) {
			console.error("Error querying HITL status:", error);
			return null;
		}
	}

	public async initialiseAgent(
		agentInfo: {
			slug: string;
			name?: string;
			description?: string;
			tags?: string[];
		},
		tools: AgentTool[],
	): Promise<{
		agentId: string;
		rules: Rule[] | null;
		budget: BudgetGrantResponse | null;
	} | null> {
		if (!this.useApi) {
			return null;
		}

		let agentId: string;
		let rules: Rule[] | null = null;
		let budget: BudgetGrantResponse | null = null;

		try {
			agentId = await this.upsertAgent(agentInfo, tools);
			this.agentId = agentId;
		} catch (e) {
			console.error("Error upserting agent:", e);
			return null;
		}

		try {
			rules = await this.fetchAgentRules(agentId);
			console.debug(`[Handlebar] Loading ${rules?.length} rules`);
		} catch (error) {
			console.error("Error fetching rules:", error);
			return null;
		}

		try {
			budget = await this.evaluateMetrics(agentId, rules ?? []);
		} catch (error) {
			console.error("Error evaluating metrics:", error);
			// best-effort — don't discard already-fetched rules on a transient budget failure
		}

		return { agentId, rules, budget };
	}

	private headers(mode?: "json"): Record<string, string> {
		const baseHeaders: Record<string, string> = {};
		if (this.apiKey) {
			baseHeaders.Authorization = `Bearer ${this.apiKey}`;
		}

		if (mode === "json") {
			baseHeaders["content-type"] = "application/json";
		}

		return baseHeaders;
	}

	async evaluateMetrics(
		agentId: string,
		rules: Rule[],
	): Promise<BudgetGrantResponse | null> {
		const ruleConditions = rules.reduce(
			(metricConditions, nextRule) => {
				if (nextRule.condition.kind === "metricWindow") {
					metricConditions.push({
						id: nextRule.id,
						...nextRule.condition,
					});
				}
				// TODO handle and/or/not which include metric windows
				return metricConditions;
			},
			[] as ({ id: string } & MetricWindowCondition)[],
		);

		if (ruleConditions.length === 0) {
			return null;
		}

		const url = new URL(
			`/v1/agents/${agentId}/metrics/budget`,
			this.apiEndpoint,
		);

		const metricRequest: z.infer<typeof MetricBudgetRequest>[] = [];

		for (const condition of ruleConditions) {
			metricRequest.push({
				id: condition.id,
				aggregate: condition.aggregate,
				budget: condition.value,
				budget_request: condition.value,
				metric: condition.metric.key,
				op: condition.op,
				scope: condition.scope,
				time_window_seconds: condition.windowSeconds,
			});
		}

		const metricRequestBody = { requests: metricRequest };
		try {
			const response = await fetch(url.toString(), {
				method: "POST",
				headers: this.headers("json"),
				body: JSON.stringify(metricRequestBody),
			});
			const data = await response.json();

			const parsedData = BudgetGrantResponseSchema.safeParse(data);
			if (!parsedData.success) {
				throw new Error("Invalid metric budget");
			}

			return parsedData.data;
		} catch (error) {
			console.error("[Handlebar] Error requesting budget:", error);
			throw error;
		}
	}

	private async upsertAgent(
		agentInfo: {
			slug: string;
			name?: string;
			description?: string;
			tags?: string[];
		},
		tools: AgentTool[],
	): Promise<string> {
		const url = new URL("/v1/agents", this.apiEndpoint);

		try {
			const agentData = JSON.stringify({
				slug: agentInfo.slug,
				name: agentInfo.name,
				description: agentInfo.description,
				tags: agentInfo.tags,
				tools,
			});
			const response = await fetch(url.toString(), {
				method: "PUT",
				headers: this.headers("json"),
				body: agentData,
			});
			const data: { agentId: string } = await response.json();
			return data.agentId; // uuidv7-like
		} catch (error) {
			console.error("Error upserting agent:", error);
			throw error;
		}
	}

	private async fetchAgentRules(agentId: string): Promise<Rule[] | null> {
		const url = new URL(`/v1/rules/agent/${agentId}`, this.apiEndpoint);

		const response = await fetch(url.toString(), {
			headers: this.headers(),
		});

		if (!response.ok) {
			throw new Error(
				`Failed to fetch agent rules: ${response.status} ${response.statusText}`,
			);
		}

		const data: { rules: Rule[] } = await response.json();
		return data.rules;
		// TODO: fix this safe parse error.
		// const schemaData = RuleSchema.array().safeParse(data.rules);
		// if (schemaData.success) {
		// 	return schemaData.data;
		// }
	}
}
