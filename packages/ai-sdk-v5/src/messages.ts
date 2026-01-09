import type { MessageEventSchema } from "@handlebar/governance-schema";
import type { ModelMessage, Prompt } from "ai";
import type { z } from "zod";

type Message = z.infer<typeof MessageEventSchema>["data"];
type FormattedMessageContent = Pick<Message, "content" | "kind" | "role">;

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

function formatModelMessage(
	messages: ModelMessage[],
): FormattedMessageContent[] {
	const formattedMessages: FormattedMessageContent[] = [];

	for (const message of messages) {
		if (typeof message.content === "string") {
			formattedMessages.push({
				content: message.content,
				kind: aiRoleToHandlebarKind(message.role),
				role: message.role,
			});
		}

		// TODO: the other types of message content!!!
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
		return formatModelMessage(prompt.messages);
	}

	return [];
}
