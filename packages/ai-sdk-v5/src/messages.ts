import type { LLMMessage } from "@handlebar/core";
import type { MessageEventSchema } from "@handlebar/governance-schema";
import { type AssistantContent, type FilePart, type ModelMessage, modelMessageSchema, type Prompt, type TextPart, type ToolCallPart, type ToolContent, type ToolResultPart } from "ai";
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

/**
 * n.b. `ReasoningPart` not exported for some reason.
 */
function formatMessagePart(part: TextPart | FilePart | ToolCallPart | ToolResultPart): string | undefined {
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

function formatToolContent(content: ToolContent, separator: string = "\n"): FormattedMessageContent {
  const partContent: string[] = [];
  for (const part of content) {
    if (Array.isArray(part.output.value)) {
      for (const subpart of part.output.value) {

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

function formatAssistantContent(content: AssistantContent, separator: string = "\n"): FormattedMessageContent {
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

  console.log(`Assistant msg ${partContent.join(separator)}`)
  return {
    content: partContent.join(separator),
    role: "assistant",
    kind: aiRoleToHandlebarKind("assistant"),
  };
}

/**
 * @todo Sort out this mess.
 */
export function formatModelMessage(message: ModelMessage): FormattedMessageContent | undefined {
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

export function combineMessageStrings(messages: ModelMessage[], opts: { includeLast?: boolean, separator?: string } = { includeLast: false, separator: " " }) {
  const messageParts = opts.includeLast ? messages : messages.slice(0, -1);
  console.log(`First message parts ${messageParts.length}`);
  if (messageParts.length === 0) {
    return undefined;
  }

  let combinedMsg = "";
  for (const msg of messageParts) {
    const formattedMsg = formatModelMessage(msg);
    console.log(`First part formatted ${formattedMsg?.content.length}`);
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
