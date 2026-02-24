import type {
	LLMMessage,
	LLMMessagePart,
} from "@handlebar/core";
import type { MessageEventSchema } from "@handlebar/governance-schema";
import {
	type AssistantContent,
	type FilePart,
	type ModelMessage,
	modelMessageSchema,
	type Prompt,
	type TextPart,
	type ToolCallPart,
	type ToolContent,
	type ToolResultPart,
} from "ai";
import type { z } from "zod";

type Message = z.infer<typeof MessageEventSchema>["data"];
type FormattedMessageContent = Pick<Message, "content" | "kind" | "role">;

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
			// We don't support file or image atm.
		}

		return {
			content: msgParts,
			role: message.role,
		};
	}

	return undefined;
}

function aiRoleToHandlebarKind(role: ModelMessage["role"]): Message["kind"] {
	switch (role) {
		case "user":
			return "input";
		case "assistant":
			return "output";
		case "system":
			return "observation";
		case "tool":
			return "tool_call";
		default:
			return "observation";
	}
}

/**
 * n.b. `ReasoningPart` not exported for some reason.
 */
function formatMessagePart(
	part: TextPart | FilePart | ToolCallPart | ToolResultPart,
): string | undefined {
	if (part.type === "text") {
		return part.text;
	}

	if (part.type === "tool-call") {
		return JSON.stringify(part.input);
	}

	if (part.type === "tool-result") {
		return JSON.stringify(part.output);
	}

	return undefined;
}

/**
 * @todo - Complete, clean, test.
 */
function formatToolContent(
	content: ToolContent,
	separator: string = "\n",
): FormattedMessageContent {
	const partContent: string[] = [];
	for (const part of content) {
		if (Array.isArray(part.output.value)) {
			for (const subpart of part.output.value) {
				// TODO: finish this!!!
			}
		}
		partContent.push(JSON.stringify(part.output));
	}

	return {
		content: partContent.join(separator),
		kind: aiRoleToHandlebarKind("tool"),
		role: "tool",
	};
}

function formatAssistantContent(
	content: AssistantContent,
	separator: string = "\n",
): FormattedMessageContent {
	if (typeof content === "string") {
		return {
			content,
			kind: aiRoleToHandlebarKind("assistant"),
			role: "assistant",
		};
	}

	const partContent: string[] = [];
	for (const part of content) {
		if (part.type === "reasoning") {
			partContent.push(part.text);
		} else {
			const partString = formatMessagePart(part);
			if (partString !== undefined) {
				partContent.push(partString);
			}
		}
	}

	return {
		content: partContent.join(separator),
		role: "assistant",
		kind: aiRoleToHandlebarKind("assistant"),
	};
}

/**
 * @todo Sort out this mess.
 */
function formatModelMessage(
	message: ModelMessage,
): FormattedMessageContent | undefined {
	const messageContent = modelMessageSchema.safeParse(message);
	if (!messageContent.success) {
		return undefined;
	}

	if (messageContent.data.role === "assistant") {
		return formatAssistantContent(messageContent.data.content);
	} else if (messageContent.data.role === "system") {
		return {
			content: messageContent.data.content,
			kind: aiRoleToHandlebarKind(messageContent.data.role),
			role: messageContent.data.role,
		};
	} else if (messageContent.data.role === "user") {
		if (typeof messageContent.data.content === "string") {
			return {
				content: messageContent.data.content,
				kind: aiRoleToHandlebarKind(messageContent.data.role),
				role: messageContent.data.role,
			};
		} else {
			// TODO: handle message parts https://ai-sdk.dev/docs/reference/ai-sdk-core/model-message#usermodelmessage
		}
	} else if (messageContent.data.role === "tool") {
		return formatToolContent(messageContent.data.content);
	}

	return undefined;
}

function formatModelMessages(
	messages: ModelMessage[],
): FormattedMessageContent[] {
	const formattedMessages: FormattedMessageContent[] = [];

	for (const message of messages) {
		const formattedMsg = formatModelMessage(message);
		if (formattedMsg) {
			formattedMessages.push(formattedMsg);
		}
	}
	return formattedMessages;
}

export function formatPrompt(prompt: Prompt): FormattedMessageContent[] {
	if (prompt.system) {
		return [{ content: prompt.system, kind: "observation", role: "system" }];
	}

	if (typeof prompt.prompt === "string") {
		// Not sure if this assumption holds (that a simple ".prompt" value is user-defined).
		// TODO: check!
		return [{ content: prompt.prompt, role: "user", kind: "input" }];
	}

	if (prompt.messages !== undefined) {
		return formatModelMessages(prompt.messages);
	}

	return [];
}
