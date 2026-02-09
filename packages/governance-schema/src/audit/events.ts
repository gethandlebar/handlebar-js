import { z } from "zod";
import {
	EndUserConfigSchema,
	EndUserGroupConfigSchema,
} from "../enduser.types";
import { AuditEnvelopeSchema } from "./events.base";
import { LLMResultEventSchema, MessageEventSchema } from "./events.llm";
import { ToolDecisionEventSchema, ToolResultEventSchema } from "./events.tools";

export const RunStartedEventSchema = AuditEnvelopeSchema.extend({
	kind: z.literal("run.started"),
	data: z.object({
		env: z.enum(["dev", "staging", "prod"]).optional(),
		agent: z.object({
			framework: z.string().optional(),
			version: z.string().optional(),
			id: z.string().optional(),
			name: z.string().optional(),
		}),
		enduser: EndUserConfigSchema.extend({
			// If a group if also provided, the user will be attached to the group.
			group: EndUserGroupConfigSchema.optional(),
		}).optional(),
		model: z
			.object({
				provider: z.string().optional(),
				name: z.string().optional(),
			})
			.optional(),
		adapter: z.object({
			name: z.string(),
			version: z.string().optional(),
		}),
		policy: z
			.object({
				version: z.string().optional(),
				ruleCount: z.number().int().nonnegative().optional(),
				sequenceId: z.string().optional(),
			})
			.optional(),
		request: z
			.object({
				id: z.string().optional(),
				traceparent: z.string().optional(),
			})
			.optional(),
	}),
});

export const RunEndedEventSchema = AuditEnvelopeSchema.extend({
	kind: z.literal("run.ended"),
	data: z.object({
		status: z.enum(["ok", "error", "blocked"]),
		totalSteps: z.number().min(0),
		firstErrorDecisionId: z.string().optional(), // DEPRECATED.
		summary: z.string().optional(),
	}),
});

export const ErrorEventSchema = AuditEnvelopeSchema.extend({
	kind: z.literal("error"),
	data: z.object({
		scope: z.enum(["governance", "adapter", "transport", "agent"]),
		message: z.string(),
		details: z.record(z.string(), z.string()).optional(),
		fatal: z.boolean().optional(),
	}),
});

export const AuditEventSchema = z.discriminatedUnion("kind", [
	RunStartedEventSchema,
	ToolDecisionEventSchema,
	ToolResultEventSchema,
	RunEndedEventSchema,
	ErrorEventSchema,
	MessageEventSchema,
	LLMResultEventSchema,
]);

export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type AuditEventByKind = {
	[E in AuditEvent as E["kind"]]: E;
};
