// Re-export core Handlebar so user's don't have to install it separately
export { Handlebar } from "@handlebar/core";

export type {
	AnyAgent,
	HandlebarAgentExecutorOpts,
	HandlebarConfig,
	RunCallOpts,
} from "./agent";
export { HandlebarAgentExecutor } from "./agent";
export { HandlebarCallbackHandler } from "./callback";
export {
	langchainMessageToLlmMessage,
	llmResultToLlmResponse,
} from "./messages";
export { HandlebarTerminationError, wrapTool, wrapTools } from "./tool";
