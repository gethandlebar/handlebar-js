import type { Rule } from "@handlebar/governance-schema";
import type { ApiConfig } from "./types";

type HitlResponse = {
				hitlId: string,
				status: "pending" | "approved" | "denied",
				pre_existing: boolean,
}

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

	public async queryHitl(runId: string, ruleId: string, toolName: string, toolArgs: Record<string, unknown>): Promise<HitlResponse | null> {
		if (!this.useApi || !this.agentId) {
			return null;
		}

		const url = new URL("/v1/audit/hitl", this.apiEndpoint);
		console.warn(`POSTING to ${url.toString()}`);
		try {
		  console.log("Querying hitl for runId:", runId, " rule: ", ruleId);
			const response = await fetch(url.toString(), {
			method: "POST",
			headers: this.headers("json"),
			body: JSON.stringify({ agentId: this.agentId, ruleId, runId, tool: { name: toolName, args: toolArgs } }),
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
      console.warn(`Upserting agent`)
      agentId = await this.upsertAgent(agentInfo)
      this.agentId = agentId;
    } catch (e) {
      console.error("Error upserting agent:", e);
      return null;
    }

    try {
      rules = await this.fetchAgentRules(agentId);
      console.warn(`Got ${rules?.length} rules from api`);
    } catch (error) {
      console.error("Error fetching rules:", error);
      return null;
    }

    return { agentId, rules };
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

	  console.warn(`Fetching ${agentId} rules at ${url.toString()}?${params.toString()}`);
		const response = await fetch(`${url.toString()}?${params.toString()}`, {
			headers: this.headers(),
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch agent rules: ${response.status} ${response.statusText}`);
		}

		const data: { rules: Rule[] } = await response.json();
		console.warn(`Rules returned are: ${JSON.stringify(data.rules)}`);
    return data.rules;
    // console.warn("Validating rule fetch data: " + JSON.stringify(data));
    // TODO: fix this safe parse error.
		// const schemaData = RuleSchema.array().safeParse(data.rules);
		// if (schemaData.success) {
		// 	return schemaData.data;
		// }
	}
}
