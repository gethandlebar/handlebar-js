import type {
	Decision,
	DecisionCause,
	EndUserConfig,
	EndUserGroupConfig,
	RuleEval,
	RunControl,
	Verdict,
} from "@handlebar/governance-schema";

// Re-export decision types from governance-schema for convenience.
export type { Decision, DecisionCause, RuleEval, RunControl, Verdict };

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

// Forward-compatible term for the human/system/agent the run acts on behalf of.
// Maps to EndUserConfig in governance-schema (kept for backward compat on the wire).
export type Actor = EndUserConfig & { group?: EndUserGroupConfig };

// ---------------------------------------------------------------------------
// Enforce mode
// ---------------------------------------------------------------------------

// enforce: evaluate rules and enforce decisions (default)
// shadow:  evaluate rules, log outcomes, but never block or terminate
// off:     skip rule evaluation entirely
export type EnforceMode = "enforce" | "shadow" | "off";

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

// Framework-agnostic tool descriptor
export type Tool<
	Name extends string = string,
	// biome-ignore lint/suspicious/noExplicitAny: phantom type for inference
	Args = any,
	// biome-ignore lint/suspicious/noExplicitAny: phantom type for inference
	Result = any,
> = {
	name: Name;
	description?: string;
	tags?: string[];

	// Phantom types — not present at runtime, used for TypeScript inference only.
	readonly _args?: Args;
	readonly _result?: Result;
};

/**
 * Tool object the Handlebar server expects.
 */
export type InsertableTool = {
	key: string; // Unique slug identifier for the tool
	name: string;
	description?: string;
	version: number;
	kind: "function" | "mcp";
	metadata?: {
		metadata?: string[];
	};
};

export type ToolCall = {
	toolName: string;
	args: unknown;
};

export type ToolResult = {
	toolName: string;
	args: unknown;
	result: unknown;
	error?: unknown;
	durationMs?: number;
};

// ---------------------------------------------------------------------------
// Sink configuration
// ---------------------------------------------------------------------------

export type HttpSinkConfig = {
	type: "http";
	endpoint?: string; // defaults to apiEndpoint from HandlebarConfig
	apiKey?: string; // defaults to apiKey from HandlebarConfig
	// Queue depth before dropping oldest events. Default: 500.
	queueDepth?: number;
	// How often to flush the queue to the API. Default: 1000ms.
	flushIntervalMs?: number;
	// Max events per HTTP batch. Default: 50.
	maxBatchSize?: number;
	// Max time to wait for queue drain on shutdown. Default: 5000ms.
	flushTimeoutMs?: number;
};

export type ConsoleSinkConfig = {
	type: "console";
	format?: "pretty" | "json"; // default "json"
};

export type SinkConfig = HttpSinkConfig | ConsoleSinkConfig;

// ---------------------------------------------------------------------------
// HandlebarConfig — global client init
// ---------------------------------------------------------------------------

export type HandlebarConfig = {
	// API credentials. Defaults to HANDLEBAR_API_KEY env var.
	apiKey?: string;
	// API base URL. Defaults to https://api.gethandlebar.com.
	apiEndpoint?: string;
	// On API unavailability: false (default) = allow, true = block.
	failClosed?: boolean;
	// Rule evaluation mode. Default: "enforce".
	enforceMode?: EnforceMode;
	// Audit event sinks. Defaults to an HTTP sink to the Handlebar API.
	sinks?: SinkConfig[];
	// Agent descriptor. Used to upsert the agent on the server.
	agent: {
		slug: string;
		name?: string;
		description?: string;
		tags?: string[];
	};
	// Tools known at init time. Registered on the server atomically with the agent.
	// Use client.registerTools() after init for tools added dynamically.
	tools?: Tool[];
};

// ---------------------------------------------------------------------------
// RunConfig — per-run init
// ---------------------------------------------------------------------------

export type RunConfig = {
	// Client-generated run ID. Scoped to (apiKey, agentId) on the server.
	runId: string;
	// Optional session grouping — multiple runs can share a session ID.
	sessionId?: string;
	// The human/system/agent the run is acting on behalf of.
	actor?: Actor;
	// Primary model configured on the agent.
	model?: ModelInfo;
	// Arbitrary tags attached to this run (for filtering / grouping).
	tags?: Record<string, string>;
	// Run lifetime before auto-close. Undefined = no TTL.
	runTtlMs?: number;
};

// ---------------------------------------------------------------------------
// Decision defaults
// ---------------------------------------------------------------------------

export const FAILOPEN_DECISION: Decision = {
	verdict: "ALLOW",
	control: "CONTINUE",
	cause: { kind: "ALLOW" },
	message: "API unavailable; failing open",
	evaluatedRules: [],
};

export const FAILCLOSED_DECISION: Decision = {
	verdict: "BLOCK",
	control: "TERMINATE",
	cause: { kind: "LOCKDOWN" },
	message: "API unavailable; failing closed",
	evaluatedRules: [],
};

// ---------------------------------------------------------------------------
// Run end status
// ---------------------------------------------------------------------------

// TODO: should we distinguish "exited because of violations" from "ran okay but with interruptions"?
export type RunEndStatus = "success" | "error" | "timeout" | "interrupted";

// ---------------------------------------------------------------------------
// LLM types
// ---------------------------------------------------------------------------

export type ModelInfo = {
	name: string;
	provider?: string;
};

export type TokenUsage = {
	inputTokens?: number;
	outputTokens?: number;
};

// Provider-agnostic message part shapes.
export type LLMMessagePart =
	| { type: "text"; text: string }
	| { type: "tool_use"; toolUseId: string; toolName: string; input: unknown }
	| { type: "tool_result"; toolUseId: string; content: string | unknown[] }
	| { type: "thinking"; thinking: string };

// Provider-agnostic message (input to the LLM).
export type LLMMessage = {
	role: "system" | "user" | "assistant" | "tool";
	content: string | LLMMessagePart[];
};

// Provider-agnostic response part shapes (output from the LLM).
export type LLMResponsePart =
	| { type: "text"; text: string }
	| { type: "tool_call"; toolCallId: string; toolName: string; args: unknown }
	| { type: "refusal"; refusal: string };

// Provider-agnostic LLM response.
//
// `content` is the canonical representation. `outputText` is a convenience
// field: if absent it is auto-derived from text parts in `content` by the core.
// After `afterLlm` returns, the core re-derives `outputText` from `content`
// so callers only need to modify `content`.
export type LLMResponse = {
	content: LLMResponsePart[];
	outputText?: string;
	model: ModelInfo;
	usage?: TokenUsage;
	durationMs?: number;
};

// Utility: derive outputText from LLMResponse.content.
export function deriveOutputText(response: LLMResponse): string {
	return response.content
		.filter(
			(p): p is Extract<LLMResponsePart, { type: "text" }> => p.type === "text",
		)
		.map((p) => p.text)
		.join("");
}
