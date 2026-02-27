import type { LLMMessage, ModelInfo, Run } from "@handlebar/core";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { BaseMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import {
	langchainMessageToLlmMessage,
	llmResultToLlmResponse,
} from "./messages";

/**
 * LangChain callback handler that bridges LLM lifecycle events to
 * Handlebar's run.beforeLlm / run.afterLlm hooks.
 *
 * Attach to executor.invoke() via the `callbacks` option.
 * HandlebarAgentExecutor does this automatically.
 */
export class HandlebarCallbackHandler extends BaseCallbackHandler {
	readonly name = "handlebar";

	private readonly run: Run;
	private readonly model: ModelInfo | undefined;

	// High-water mark: messages forwarded to beforeLlm so far.
	// Prevents re-emitting the accumulated history on each subsequent agent step.
	private msgCount = 0;

	constructor(run: Run, model?: ModelInfo) {
		super();
		this.run = run;
		this.model = model;
	}

	/**
	 * Fires before each chat-model call.
	 * Emits message.raw.created events only for messages new since the last call.
	 */
	override async handleChatModelStart(
		_llm: Serialized,
		messages: BaseMessage[][],
	): Promise<void> {
		const allMsgs = messages[0] ?? [];
		const newMsgs = allMsgs.slice(this.msgCount);

		const llmMessages = newMsgs.flatMap((msg) => {
			const converted = langchainMessageToLlmMessage(msg);
			return converted ? [converted] : [];
		}) satisfies LLMMessage[];

		if (llmMessages.length > 0) {
			await this.run.beforeLlm(llmMessages);
		}

		this.msgCount = allMsgs.length;
	}

	/**
	 * Fires after each LLM step with generated output and token usage.
	 * Emits llm.result and message.raw.created (assistant response) events.
	 * Skipped if no model info was provided at construction time.
	 */
	override async handleLLMEnd(output: LLMResult): Promise<void> {
		if (!this.model) {
			return;
		}
		const response = llmResultToLlmResponse(output, this.model);
		await this.run.afterLlm(response);
	}
}
