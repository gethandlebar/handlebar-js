import type { AuditEvent } from "@handlebar/governance-schema";
import { uuidv7 } from "uuidv7";
import type {
	ApiManager,
	EvaluateAfterRequest,
	EvaluateBeforeRequest,
} from "./api/manager";
import type { AgentMetricHookRegistry } from "./metrics/hooks";
import type { SinkBus } from "./sinks/bus";
import type { SubjectRegistry } from "./subjects";
import { sanitiseSubjects } from "./subjects";
import type {
	Actor,
	Decision,
	LLMMessage,
	LLMResponse,
	LLMResponsePart,
	ModelInfo,
	RunConfig,
	RunEndStatus,
	ToolResult,
} from "./types";
import { deriveOutputText, FAILOPEN_DECISION } from "./types";

export type RunState = "active" | "ended";

export type RunInternalConfig = {
	runConfig: RunConfig;
	agentId: string | null;
	enforceMode: "enforce" | "shadow" | "off";
	failClosed: boolean;
	api: ApiManager;
	bus: SinkBus;
	metricRegistry?: AgentMetricHookRegistry;
	subjectRegistry?: SubjectRegistry;
};

export class Run {
	readonly runId: string;
	readonly sessionId: string | undefined;
	readonly actor: Actor | undefined;
	readonly tags: Record<string, string>;

	private state: RunState = "active";
	private stepIndex = 0;
	private readonly history: ToolResult[] = [];

	private readonly agentId: string | null;
	private readonly enforceMode: "enforce" | "shadow" | "off";
	private readonly api: ApiManager;
	private readonly bus: SinkBus;
	private readonly metricRegistry: AgentMetricHookRegistry | undefined;
	private readonly subjectRegistry: SubjectRegistry | undefined;
	private ttlTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(config: RunInternalConfig) {
		this.runId = config.runConfig.runId;
		this.sessionId = config.runConfig.sessionId;
		this.actor = config.runConfig.actor;
		this.tags = config.runConfig.tags ?? {};
		this.agentId = config.agentId;
		this.enforceMode = config.enforceMode;
		this.api = config.api;
		this.bus = config.bus;
		this.metricRegistry = config.metricRegistry;
		this.subjectRegistry = config.subjectRegistry;

		// Schedule auto-close if TTL is configured.
		if (config.runConfig.runTtlMs != null && config.runConfig.runTtlMs > 0) {
			this.ttlTimer = setTimeout(() => {
				void this.end("timeout");
			}, config.runConfig.runTtlMs);
			if (
				typeof this.ttlTimer === "object" &&
				this.ttlTimer !== null &&
				"unref" in this.ttlTimer
			) {
				(this.ttlTimer as { unref(): void }).unref();
			}
		}

		// Emit run.started.
		this.emitRunStarted();
	}

	// ---------------------------------------------------------------------------
	// Lifecycle hooks
	// ---------------------------------------------------------------------------

	// Call before invoking a tool. Returns the Decision from the server.
	// In shadow/off mode, always returns ALLOW without enforcing.
	async beforeTool(
		toolName: string,
		args: unknown,
		toolTags?: string[],
	): Promise<Decision> {
		if (this.state !== "active") {
			return FAILOPEN_DECISION;
		}
		if (this.enforceMode === "off") {
			return FAILOPEN_DECISION;
		}

		// Collect tool.before metrics: bytes_in from args plus custom hook values.
		const beforeMetrics: NonNullable<EvaluateBeforeRequest["metrics"]> = {};
		const bytesIn = approxBytes(args);
		if (bytesIn != null) {
			beforeMetrics.bytes_in = bytesIn;
		}
		if (this.metricRegistry) {
			await this.metricRegistry.runPhase(
				"tool.before",
				{ toolName, args, run: this },
				(key, value) => {
					beforeMetrics[key] = value;
				},
			);
		}

		// Extract subjects — client-side entity context sent to server for rule evaluation.
		let subjects: ReturnType<typeof sanitiseSubjects> | undefined;
		if (this.subjectRegistry) {
			const raw = await this.subjectRegistry.extract({
				tool: { tags: toolTags, description: undefined },
				toolName,
				toolArgs: args,
				run: this,
			});
			if (raw.length > 0) {
				subjects = sanitiseSubjects(raw);
			}
		}

		const req: EvaluateBeforeRequest = {
			phase: "tool.before",
			agentId: this.agentId ?? "",
			tool: { name: toolName, tags: toolTags },
			args,
			actor: this.actor ? { externalId: this.actor.externalId } : undefined,
			tags: this.tags,
			subjects,
			metrics:
				Object.keys(beforeMetrics).length > 0 ? beforeMetrics : undefined,
		};

		const decision = await this.api.evaluate(this.runId, req);

		// Emit tool.decision event.
		this.emit({
			schema: "handlebar.audit.v1",
			ts: new Date(),
			runId: this.runId,
			sessionId: this.sessionId,
			actorExternalId: this.actor?.externalId,
			stepIndex: this.stepIndex,
			kind: "tool.decision",
			data: {
				// New core fields.
				verdict: decision.verdict,
				control: decision.control,
				cause: decision.cause,
				evaluatedRules: decision.evaluatedRules,
				finalRuleId: decision.finalRuleId,
				// Required legacy fields (satisfy schema — new core leaves them empty).
				effect: decision.verdict === "ALLOW" ? "allow" : "block",
				// biome-ignore lint/suspicious/noExplicitAny: legacy schema compat
				code: (decision.verdict === "ALLOW"
					? "ALLOWED"
					: "BLOCKED_RULE") as any,
				matchedRuleIds: decision.evaluatedRules
					.filter((r) => r.matched)
					.map((r) => r.ruleId),
				appliedActions: [],
				tool: { name: toolName, categories: toolTags },
			},
		});

		// In shadow mode: always return ALLOW after logging.
		if (this.enforceMode === "shadow") {
			return FAILOPEN_DECISION;
		}
		return decision;
	}

	// Call after a tool returns (or throws).
	// Increments stepIndex. Emits tool.result. Records to history.
	async afterTool(
		toolName: string,
		args: unknown,
		result: unknown,
		durationMs?: number,
		error?: unknown,
		toolTags?: string[],
	): Promise<Decision> {
		if (this.state !== "active") {
			return FAILOPEN_DECISION;
		}

		const toolResult: ToolResult = {
			toolName,
			args,
			result,
			error,
			durationMs,
		};
		this.history.push(toolResult);

		const builtinMetrics = buildMetrics(args, result, durationMs);
		const metrics: NonNullable<EvaluateAfterRequest["metrics"]> = {
			...builtinMetrics,
		};

		// Run tool.after metric hooks and merge custom key/value results into metrics.
		if (this.metricRegistry) {
			await this.metricRegistry.runPhase(
				"tool.after",
				{ toolName, args, result, error, run: this },
				(key, value) => {
					metrics[key] = value;
				},
			);
		}

		// Extract subjects for the after-phase evaluate request.
		let subjectsAfter: ReturnType<typeof sanitiseSubjects> | undefined;
		if (this.subjectRegistry) {
			const raw = await this.subjectRegistry.extract({
				tool: { tags: toolTags, description: undefined },
				toolName,
				toolArgs: args,
				run: this,
			});
			if (raw.length > 0) {
				subjectsAfter = sanitiseSubjects(raw);
			}
		}

		const req: EvaluateAfterRequest = {
			phase: "tool.after",
			agentId: this.agentId ?? "",
			tool: { name: toolName, tags: toolTags },
			args,
			result,
			actor: this.actor ? { externalId: this.actor.externalId } : undefined,
			tags: this.tags,
			subjects: subjectsAfter,
			metrics: Object.keys(metrics).length > 0 ? metrics : undefined,
		};

		const decision =
			this.enforceMode === "off"
				? FAILOPEN_DECISION
				: await this.api.evaluate(this.runId, req);

		// Emit tool.result event.
		const errorAsError = error instanceof Error ? error : null;
		this.emit({
			schema: "handlebar.audit.v1",
			ts: new Date(),
			runId: this.runId,
			sessionId: this.sessionId,
			actorExternalId: this.actor?.externalId,
			stepIndex: this.stepIndex,
			kind: "tool.result",
			data: {
				tool: { name: toolName, categories: toolTags },
				outcome: error ? "error" : "success",
				durationMs,
				error: errorAsError
					? { name: errorAsError.name, message: errorAsError.message }
					: undefined,
			},
		});

		this.stepIndex++;
		return this.enforceMode === "shadow" ? FAILOPEN_DECISION : decision;
	}

	// Call before sending messages to the LLM.
	// Returns (possibly modified) messages — surface for future PII redaction.
	async beforeLlm(
		messages: LLMMessage[],
		meta?: { model?: ModelInfo },
	): Promise<LLMMessage[]> {
		if (this.state !== "active") {
			return messages;
		}

		// Emit one message.raw.created event per message being sent to the LLM.
		// Future: evaluate LLM-level rules, redact PII before returning.
		for (const msg of messages) {
			this.emit({
				schema: "handlebar.audit.v1",
				ts: new Date(),
				runId: this.runId,
				sessionId: this.sessionId,
				actorExternalId: this.actor?.externalId,
				stepIndex: this.stepIndex,
				kind: "message.raw.created",
				data: {
					messageId: uuidv7(),
					role: msg.role,
					kind: llmRoleToKind(msg.role),
					content:
						typeof msg.content === "string"
							? msg.content
							: JSON.stringify(msg.content),
					contentTruncated: false,
				},
			});
		}

		return messages;
	}

	// Call after the LLM responds.
	// Returns (possibly modified) response — surface for future response rewriting.
	async afterLlm(response: LLMResponse): Promise<LLMResponse> {
		if (this.state !== "active") {
			return response;
		}

		// Re-derive outputText from content after any hook modifications.
		const resolved: LLMResponse = {
			...response,
			outputText: deriveOutputText(response) || response.outputText,
		};

		const inTokens = resolved.usage?.inputTokens;
		const outTokens = resolved.usage?.outputTokens;

		if (inTokens !== undefined || outTokens !== undefined) {
			this.emit({
				schema: "handlebar.audit.v1",
				ts: new Date(),
				runId: this.runId,
				sessionId: this.sessionId,
				actorExternalId: this.actor?.externalId,
				stepIndex: this.stepIndex,
				kind: "llm.result",
				data: {
					model: {
						name: resolved.model.name,
						provider: resolved.model.provider,
					},
					tokens: { in: inTokens ?? 0, out: outTokens ?? 0 },
					messageCount: resolved.content.length,
					durationMs: resolved.durationMs,
				},
			});
		}

		this.emit({
			schema: "handlebar.audit.v1",
			kind: "message.raw.created",
			ts: new Date(),
			runId: this.runId,
			sessionId: this.sessionId,
			actorExternalId: this.actor?.externalId,
			stepIndex: this.stepIndex,
			data: {
				messageId: uuidv7(),
				role: "assistant",
				kind: "output",
				// Use plain text when available; fall back to serialised content parts
				// (e.g. when the step only emitted tool calls and step.text is empty).
				content: resolved.outputText || JSON.stringify(resolved.content),
				contentTruncated: false,
			},
		});

		return resolved;
	}

	// End this run. Idempotent — calling end() twice is a no-op after the first.
	async end(status: RunEndStatus = "success"): Promise<void> {
		if (this.state === "ended") {
			return;
		}
		this.state = "ended";

		if (this.ttlTimer !== null) {
			clearTimeout(this.ttlTimer);
			this.ttlTimer = null;
		}

		await this.api.endRun(this.runId, this.agentId, status);
		this.emit({
			schema: "handlebar.audit.v1",
			ts: new Date(),
			runId: this.runId,
			sessionId: this.sessionId,
			actorExternalId: this.actor?.externalId,
			kind: "run.ended",
			data: { status, totalSteps: this.stepIndex },
		});
		// Flush so run.ended (and any other queued events) are delivered even if
		// the process exits immediately after generate/stream/respond returns.
		await this.bus.drain();
	}

	// ---------------------------------------------------------------------------
	// Read-only accessors
	// ---------------------------------------------------------------------------

	get isEnded(): boolean {
		return this.state === "ended";
	}

	get currentStepIndex(): number {
		return this.stepIndex;
	}

	getHistory(): readonly ToolResult[] {
		return this.history;
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	private emitRunStarted(): void {
		this.emit({
			schema: "handlebar.audit.v1",
			ts: new Date(),
			runId: this.runId,
			sessionId: this.sessionId,
			actorExternalId: this.actor?.externalId,
			kind: "run.started",
			data: {
				agent: { id: this.agentId ?? undefined },
				actor: this.actor
					? { externalId: this.actor.externalId, metadata: this.actor.metadata }
					: undefined,
				// TODO: get adapter from config.
				adapter: { name: "core" },
			},
		});
	}

	private emit(event: AuditEvent): void {
		if (this.agentId) {
			this.bus.emit(this.agentId, event);
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMetrics(
	args: unknown,
	result: unknown,
	durationMs?: number,
): EvaluateAfterRequest["metrics"] {
	const metrics: EvaluateAfterRequest["metrics"] = {};
	const bytesIn = approxBytes(args);
	if (bytesIn != null) {
		metrics.bytes_in = bytesIn;
	}

	const bytesOut = approxBytes(result);
	if (bytesOut != null) {
		metrics.bytes_out = bytesOut;
	}

	if (durationMs != null) {
		metrics.duration_ms = durationMs;
	}

	return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function llmRoleToKind(
	role: LLMMessage["role"],
): "input" | "output" | "tool_call" | "tool_result" | "observation" {
	switch (role) {
		case "user":
			return "input";
		case "assistant":
			return "output";
		case "tool":
			return "tool_result";
		default:
			return "observation"; // system, developer
	}
}

function approxBytes(value: unknown): number | null {
	if (value == null) {
		return null;
	}
	try {
		return new TextEncoder().encode(JSON.stringify(value)).length;
	} catch {
		return null;
	}
}
