import type { LLMMessage, LLMMessagePart } from "@handlebar/core";
import {
	type ModelMessage,
	modelMessageSchema,
} from "ai";

export function modelMessageToLlmMessage(
	message: ModelMessage,
): LLMMessage | undefined {
	if (typeof message.content === "string") {
		return {
			role: message.role,
			content: message.content,
		};
	}

	if (Array.isArray(message.content)) {
		const msgParts: LLMMessagePart[] = [];

		for (const part of message.content) {
			if (part.type === "text") {
				msgParts.push({
					type: "text",
					text: part.text,
				});
			} else if (part.type === "reasoning") {
				msgParts.push({
					type: "thinking",
					thinking: part.text,
				});
			} else if (part.type === "tool-call") {
				msgParts.push({
					type: "tool_use",
					toolName: part.toolName,
					input: part.input,
					toolUseId: part.toolCallId,
				});
			} else if (part.type === "tool-result") {
				msgParts.push({
					type: "tool_result",
					toolUseId: part.toolCallId,
					content:
						typeof part.output === "string"
							? part.output
							: JSON.stringify(part.output),
				});
			}
			// file/image not supported
		}

		return {
			content: msgParts,
			role: message.role,
		};
	}

	return undefined;
}
