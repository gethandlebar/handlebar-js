import { DecisionSchema } from "@handlebar/governance-schema";
import type { SubjectRef } from "../subjects";
import type {
	Actor,
	Decision,
	HandlebarConfig,
	ModelInfo,
	RunEndStatus,
	Tool,
} from "../types";
import { FAILCLOSED_DECISION, FAILOPEN_DECISION } from "../types";

const DEFAULT_ENDPOINT = "https://api.gethandlebar.com";

const RETRY_DEFAULTS = {
	maxRetries: 3,
	baseMs: 200,
	capMs: 5_000,
} as const;

// Lockdown status returned from run start.
export type LockdownStatus = {
	active: boolean;
	reason?: string;
	// Unix timestamp (ms) after which lockdown lifts. null = indefinite.
	until?: number | null;
};

type BaseEvaluateRequest = {
  agentId: string;
	tool: { name: string; tags?: string[] };
	args: unknown;
	actor?: { externalId: string };
	tags?: Record<string, string>;
  subjects?: SubjectRef[];
  metrics?: {
  	bytes_in?: number;
  	bytes_out?: number;
  	records_out?: number;
  	duration_ms?: number;
  	[key: string]: number | undefined;
	};
}

// Evaluate request for tool.before phase.
export type EvaluateBeforeRequest = BaseEvaluateRequest & {
	phase: "tool.before";
};

// Evaluate request for tool.after phase — includes per-call metrics.
export type EvaluateAfterRequest = BaseEvaluateRequest & {
	phase: "tool.after";
	result?: unknown;
};

export type EvaluateRequest = EvaluateBeforeRequest | EvaluateAfterRequest;

export class ApiManager {
	private readonly endpoint: string;
	private readonly apiKey: string | undefined;
	private readonly failClosed: boolean;
	private readonly retryBaseMs: number;
	// Whether API integration is active (key + endpoint present).
	private readonly active: boolean;

	constructor(
		config: Pick<HandlebarConfig, "apiKey" | "apiEndpoint" | "failClosed"> & {
			// Test-only: override retry base delay.
			_retryBaseMs?: number;
		},
	) {
		this.endpoint =
			config.apiEndpoint ??
			process.env.HANDLEBAR_API_ENDPOINT ??
			DEFAULT_ENDPOINT;
		this.apiKey = config.apiKey ?? process.env.HANDLEBAR_API_KEY;
		this.failClosed = config.failClosed ?? false;
		this.retryBaseMs = config._retryBaseMs ?? RETRY_DEFAULTS.baseMs;
		this.active = Boolean(this.apiKey);
	}

	// ---------------------------------------------------------------------------
	// Agent registration
	// ---------------------------------------------------------------------------

	// Upsert agent and (optionally) register tools atomically.
	// Returns the server-assigned agentId.
	async upsertAgent(
		agent: HandlebarConfig["agent"],
		tools?: Tool[],
	): Promise<string | null> {
		if (!this.active) {
			return null;
		}

		const url = this.url("/v1/agents");
		const body: Record<string, unknown> = {
			slug: agent.slug,
			name: agent.name,
			description: agent.description,
			tags: agent.tags,
		};
		if (tools?.length) {
			body.tools = tools.map((t) => ({
				name: t.name,
				description: t.description,
				tags: t.tags,
			}));
		}

		try {
			const res = await this.post(url, body);
			if (!res.ok) {
				console.error(`[Handlebar] Agent upsert failed: ${res.status}`);
				return null;
			}
			const data = (await res.json()) as { agentId: string };
			return data.agentId;
		} catch (err) {
			console.error("[Handlebar] Agent upsert error:", err);
			return null;
		}
	}

	// Register or update tools on an existing agent.
	async registerTools(agentId: string, tools: Tool[]): Promise<boolean> {
		if (!this.active || !tools.length) {
			return true;
		}

		const url = this.url(`/v1/agents/${agentId}/tools`);
		const body = {
			tools: tools.map((t) => ({
				name: t.name,
				description: t.description,
				tags: t.tags,
			})),
		};

		try {
			const res = await this.put(url, body);
			if (!res.ok) {
				console.error(`[Handlebar] Tool registration failed: ${res.status}`);
				return false;
			}
			return true;
		} catch (err) {
			console.error("[Handlebar] Tool registration error:", err);
			return false;
		}
	}

	// ---------------------------------------------------------------------------
	// Run start (preflight merged)
	// ---------------------------------------------------------------------------

	// Start a run on the server. Returns lockdown status.
	// Equivalent to the old preflight endpoint, merged into run start.
	async startRun(
		runId: string,
		agentId: string,
		opts?: { sessionId?: string; actor?: Actor; model?: ModelInfo },
	): Promise<LockdownStatus> {
		if (!this.active) {
			return { active: false };
		}

		const url = this.url(`/v1/runs/${runId}/start`);
		const body: Record<string, unknown> = { agentId };

		if (opts?.sessionId) {
			body.sessionId = opts.sessionId;
		}

		if (opts?.actor) {
			body.actor = opts.actor;
		}

		if (opts?.model) {
			body.model = opts.model;
		}

		try {
			const res = await this.post(url, body);
			if (!res.ok) {
				console.warn(
					`[Handlebar] Run start returned ${res.status}; assuming no lockdown`,
				);
				return { active: false };
			}
			const data = (await res.json()) as {
				lockdown: {
					active: boolean;
					reason?: string;
					until_ts?: number | null;
				};
			};
			return {
				active: data.lockdown.active,
				reason: data.lockdown.reason,
				until: data.lockdown.until_ts,
			};
		} catch (err) {
			console.error("[Handlebar] Run start error:", err);
			return { active: false };
		}
	}

	async endRun(
		runId: string,
		agentId: string | null,
		status: RunEndStatus,
	): Promise<void> {
		if (!this.active || agentId === null) {
			return;
		}

		const url = this.url(`/v1/runs/${runId}/end`);
		const body = { agentId, status };

		try {
			const res = await this.postWithRetry(url, body, {
				retryBaseMs: this.retryBaseMs,
			});
			if (!res.ok) {
				console.warn(`[Handlebar] Run end returned ${res.status}`);
				return;
			}
			return;
		} catch (err) {
			console.error("[Handlebar] Run end error:", err);
			return;
		}
	}

	// ---------------------------------------------------------------------------
	// Rule evaluation
	// ---------------------------------------------------------------------------

	// Evaluate a tool call against active rules. Returns a Decision.
	// On API unavailability, falls back per failClosed config.
	async evaluate(runId: string, req: EvaluateRequest): Promise<Decision> {
		if (!this.active) {
			return this.failClosedDecision();
		}

		const url = this.url(`/v1/runs/${runId}/evaluate`);

		try {
			const res = await this.postWithRetry(url, req, {
				retryBaseMs: this.retryBaseMs,
			});
			if (!res.ok) {
				console.error(`[Handlebar] Evaluate returned ${res.status}`);
				return this.failClosedDecision();
			}
			const raw = await res.json();
			const parsed = DecisionSchema.safeParse(raw);
			if (!parsed.success) {
				console.error(
					"[Handlebar] Evaluate response invalid:",
					parsed.error.message,
				);
				return this.failClosedDecision();
			}
			return parsed.data;
		} catch (err) {
			console.error("[Handlebar] Evaluate error:", err);
			return this.failClosedDecision();
		}
	}

	// ---------------------------------------------------------------------------
	// Internal helpers
	// ---------------------------------------------------------------------------

	private url(path: string): string {
		return `${this.endpoint}${path}`;
	}

	private failClosedDecision(): Decision {
		return this.failClosed ? FAILCLOSED_DECISION : FAILOPEN_DECISION;
	}

	private headers(): Record<string, string> {
		const h: Record<string, string> = { "content-type": "application/json" };
		if (this.apiKey) {
			h.Authorization = `Bearer ${this.apiKey}`;
		}
		return h;
	}

	private post(url: string, body: unknown): Promise<Response> {
		return fetch(url, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(body),
		});
	}

	private put(url: string, body: unknown): Promise<Response> {
		return fetch(url, {
			method: "PUT",
			headers: this.headers(),
			body: JSON.stringify(body),
		});
	}

	// POST with exponential backoff retry on network errors and 5xx.
	private async postWithRetry(
		url: string,
		body: unknown,
		opts?: { retryBaseMs?: number },
	): Promise<Response> {
		const baseMs = opts?.retryBaseMs ?? RETRY_DEFAULTS.baseMs;
		let attempt = 0;

		while (true) {
			try {
				const res = await this.post(url, body);
				// Don't retry on 4xx.
				if (res.ok || (res.status >= 400 && res.status < 500)) {
					return res;
				}

				throw new Error(`HTTP ${res.status}`);
			} catch (err) {
				if (attempt >= RETRY_DEFAULTS.maxRetries) {
					throw err;
				}

				const backoffMs = Math.min(baseMs * 2 ** attempt, RETRY_DEFAULTS.capMs);
				await sleep(backoffMs);
				attempt++;
			}
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
