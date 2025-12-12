import { type Rule, RuleSchema } from "@handlebar/governance-schema";
import type { ApiConfig } from "./types";

export class ApiManager {
	private useApi: boolean;
	private apiKey: string | undefined;
	private apiEndpoint: string;
  private agentId: string | undefined;

	constructor(config: ApiConfig, agentId?: string) {
		this.apiEndpoint =
			config.apiEndpoint ??
			process.env.HANDLEBAR_API_ENDPOINT ??
			"https://api.gethandlebar.com";
		this.apiKey = config.apiKey ?? process.env.HANDLEBAR_API_KEY;
		this.useApi = this.apiEndpoint !== undefined && this.apiKey !== undefined;
    this.agentId = agentId;
	}

  public async initialiseAgent(agentInfo: {
    slug: string;
    name?: string;
    description?: string;
    tags?: string[];
  }): Promise<{ agentId: string, rules: Rule[] | null} | null> {
    if (!this.useApi) {
      return null;
    }

    let agentId: string
    let rules: Rule[] | null = null;

    try {
      agentId = await this.upsertAgent(agentInfo)
      this.agentId = agentId;
    } catch {
      return null;
    }

    try {
      rules = await this.fetchAgentRules(agentId);
    } catch {
      return null;
    }

    return { agentId, rules };
  }

	private headers(mode: "json"): Record<string, string> {
		const baseHeaders: Record<string, string> = {};
		if (this.apiKey) {
      baseHeaders.Authorization = `Bearer ${this.apiKey}`;
		}

		if (mode === "json") {
		baseHeaders["content-type"] = "application/json";
		}

		return baseHeaders;
	}

	private async upsertAgent(
	agentInfo: {
    slug: string;
    name?: string;
    description?: string;
    tags?: string[];
  }
	): Promise<string> {

    const url = new URL("/v1/agent", this.apiEndpoint);

    try {
      const response = await fetch(url.toString(), {
        method: "PUT",
        headers: this.headers("json"),
        body: JSON.stringify({ slug: agentInfo.slug, name: agentInfo.name, description: agentInfo.description, tags: agentInfo.tags }),
      });
      const data: { agentId: string } = await response.json();
      return data.agentId; // uuidv7-like
    } catch (error) {
      console.error("Error upserting agent:", error);
      throw error;
    }
	}

	private async fetchAgentRules(
		agentId: string,
	): Promise<Rule[] | null> {
		 const url = new URL("/v1/rules", this.apiEndpoint);
			const params = new URLSearchParams({
			agentId,
			})

		const response = await fetch(url.toString() + params.toString(), {
			headers: this.headers("json"),
		});
		const data = await response.json();

		const schemaData = RuleSchema.array().safeParse(data);
		if (schemaData.success) {
			return schemaData.data;
		}

		return null;
	}
}
