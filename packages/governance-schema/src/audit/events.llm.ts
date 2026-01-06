import { z } from "zod";
import { AuditEnvelopeSchema } from "./events.base";

export const MessageRoleSchema = z.enum(["system", "developer", "user", "assistant", "tool"]);


/**
 * Message "kind" is about how it appears in an agent flow.
 * - input: user message
 * - output: assistant natural language output
 * - tool_call: assistant initiated tool call (as text/JSON tool call)
 * - tool_result: tool return value summarised or raw ref
 * - observation: agent framework observation (non-tool, e.g. environment signal)
 * - internal_summary: optional short summary generated for UI
 * - thinking: model CoT
 *
 */
export const MessageKindSchema = z.enum([
	"input",
	"output",
	"tool_call",
	"tool_result",
	"observation",
	"internal_summary",
	"thinking",
]);

export const MessageSchema = z.object({
	messageId: z.uuidv7(),
	role: MessageRoleSchema,
	kind: MessageKindSchema,

	content: z.string(),
	contentTruncated: z.boolean(),

	// Helpful linking (optional)
	parentMessageId: z.uuidv7().optional(), // for threading
	turnIndex: z.number().int().min(0).optional(), // monotonic within run
	name: z.string().optional(), // e.g. tool name, or assistant persona name
	tags: z.array(z.string()).optional(), // arbitrary labels for filtering
});

export const MessageEventSchema = AuditEnvelopeSchema.extend({
  kind: z.literal("message.created"),
  data: MessageSchema,
});
