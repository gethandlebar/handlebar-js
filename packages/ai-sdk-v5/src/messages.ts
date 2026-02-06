import type { LLMMessage } from "@handlebar/core";
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

export function formatModelMessage(message: ModelMessage): FormattedMessageContent | undefined {
  if (typeof message.content === "string") {
		return {
			content: message.content,
			kind: aiRoleToHandlebarKind(message.role),
			role: message.role,
		};
  }
	// TODO: the other types of message content!!!

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

export function combineMessageStrings(messages: ModelMessage[], opts: { includeLast?: boolean, separator?: string } = { includeLast: false, separator: " " }) {
  const messageParts = opts.includeLast ? messages : messages.slice(0, -1);
  if (messageParts.length === 0) {
    return undefined;
  }

  let combinedMsg = "";
  for (const msg of messageParts) {
    const formattedMsg = formatModelMessage(msg);
    if (formattedMsg) {
      combinedMsg += formattedMsg.content + opts.separator;
    }
  }

  if (combinedMsg.length === 0) {
    return undefined;
  }

  return combinedMsg;
}


export function toLLMMessages(messages: ModelMessage[]): LLMMessage[] {
  return messages.reduce((llmMsgs, nextModelMsg) => {
    const formatted = formatModelMessage(nextModelMsg);
    if (formatted) {
      llmMsgs.push({
        content: formatted.content,
        kind: formatted.role,
      });
    }
    return llmMsgs;
  }, [] as LLMMessage[]);
}
