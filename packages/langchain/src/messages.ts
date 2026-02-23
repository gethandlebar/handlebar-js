import type { NewLLMMessage, LLMResponse, LLMResponsePart, ModelInfo, TokenUsage } from "@handlebar/core";
import type { BaseMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";

function langchainRoleToLlmRole(type: string): NewLLMMessage["role"] | undefined {
	switch (type) {
		case "human":
			return "user";
		case "ai":
			return "assistant";
		case "system":
			return "system";
		case "tool":
		case "function":
			return "tool";
		default:
			return undefined;
	}
}

export function langchainMessageToLlmMessage(msg: BaseMessage): NewLLMMessage | undefined {
	const role = langchainRoleToLlmRole(msg._getType());
	if (!role) return undefined;

	if (typeof msg.content === "string") {
		return { role, content: msg.content };
	}

	// Complex content blocks — serialise to string.
	return { role, content: JSON.stringify(msg.content) };
}

export function llmResultToLlmResponse(output: LLMResult, model: ModelInfo): LLMResponse {
	const content: LLMResponsePart[] = [];
	const firstBatch = output.generations[0] ?? [];

	for (const gen of firstBatch) {
		if (gen.text) {
			content.push({ type: "text", text: gen.text });
		}

		// Extract tool calls from ChatGeneration.message (provider-specific shapes).
		// biome-ignore lint/suspicious/noExplicitAny: ChatGeneration shape varies by provider
		const chatGen = gen as any;
		// LangChain v0.3 structured tool calls on the message object.
		// biome-ignore lint/suspicious/noExplicitAny: tool call shape varies
		const toolCalls: any[] =
			chatGen.message?.tool_calls ??
			chatGen.message?.additional_kwargs?.tool_calls ??
			[];
		for (const tc of toolCalls) {
			content.push({
				type: "tool_call",
				toolCallId: tc.id ?? tc.tool_call_id ?? "",
				toolName: tc.name ?? tc.function?.name ?? "",
				// LangChain v0.3 has tc.args (object); older providers may have tc.function.arguments (JSON string).
				args:
					tc.args ??
					(typeof tc.function?.arguments === "string"
						? JSON.parse(tc.function.arguments)
						: tc.function?.arguments) ??
					{},
			});
		}
	}

	return { content, model, usage: extractTokenUsage(output.llmOutput) };
}

function extractTokenUsage(llmOutput?: Record<string, unknown>): TokenUsage | undefined {
	if (!llmOutput) return undefined;
	// biome-ignore lint/suspicious/noExplicitAny: token usage shape varies by provider
	const u = (llmOutput.tokenUsage ?? llmOutput.usage ?? llmOutput.token_usage) as any;
	if (!u || typeof u !== "object") return undefined;
	return {
		inputTokens: u.promptTokens ?? u.prompt_tokens ?? u.input_tokens,
		outputTokens: u.completionTokens ?? u.completion_tokens ?? u.output_tokens,
	};
}
