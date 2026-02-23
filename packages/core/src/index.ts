export * from "./audit";
export * from "./engine";
export * from "./metrics";
export type { HandlebarRunOpts } from "./runs";
export { type LLMMessage, tokeniseCount } from "./tokens";
export * from "./types";
export { generateSlug } from "./utils";

// ---------------------------------------------------------------------------
// New core — export alongside legacy engine until migration is complete.
// Tool/ToolCall/ToolResult are intentionally not re-exported here to avoid
// naming conflicts with the legacy types of the same name.
// ---------------------------------------------------------------------------
export {
	Handlebar,
	HandlebarClient,
	withRun,
	getCurrentRun,
} from "./new_core/client";
export { Run } from "./new_core/run";
export type { RunState, RunInternalConfig } from "./new_core/run";
export { defineTool, wrapTool } from "./new_core/tool";
export type { ToolMeta as NewToolMeta } from "./new_core/tool";
export type {
	Actor,
	Decision,
	DecisionCause,
	EnforceMode,
	HandlebarConfig,
	LLMMessage as NewLLMMessage,
	LLMMessagePart,
	LLMResponse,
	LLMResponsePart,
	ModelInfo,
	RunConfig,
	RunEndStatus,
	SinkConfig,
	TokenUsage,
	Verdict,
	RunControl,
	RuleEval,
	FAILOPEN_DECISION as FailOpenDecision,
	FAILCLOSED_DECISION as FailClosedDecision,
} from "./new_core/types";
export {
	FAILOPEN_DECISION,
	FAILCLOSED_DECISION,
	deriveOutputText,
} from "./new_core/types";
export { SinkBus, createConsoleSink, createHttpSink } from "./new_core/sinks";
export type { Sink } from "./new_core/sinks";
