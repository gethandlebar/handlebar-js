/** biome-ignore-all lint/correctness/noUnusedImports: WIP */
import { RuleSchema } from "@handlebar/governance-schema";
import type z from "zod";
import type { ApiConfig } from "./types";

export class ApiManager {
	private useApi: boolean;
	private apiKey: string | undefined;
	private apiEndpoint: string;

	constructor(config: ApiConfig) {
		this.apiEndpoint =
			config.apiEndpoint ??
			process.env.HANDLEBAR_API_ENDPOINT ??
			"http://localhost:8000"; // TODO: default to prod api when live.
		this.apiKey = config.apiKey ?? process.env.HANDLEBAR_API_KEY;
		this.useApi = this.apiEndpoint !== undefined || this.apiKey !== undefined;
	}

	private headers(): Record<string, string> {
		if (this.apiKey) {
			return {
				Authorization: `Bearer ${this.apiKey}`,
			};
		}

		return {};
	}

	private async fetchAgentRules(
		agentName: string,
	): Promise<z.infer<typeof RuleSchema> | null> {
		if (!this.useApi) {
			return null;
		}

		const response = await fetch(`${this.apiEndpoint}`, {
			headers: this.headers(),
			body: JSON.stringify({ agentName }),
		});
		const data = await response.json();

		const schemaData = RuleSchema.safeParse(data);
		if (schemaData.success) {
			return schemaData.data;
		}

		return null;
	}
}
