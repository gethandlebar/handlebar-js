import { z } from "zod";
import { GovernanceDecisionSchema } from "./governance-actions";

const CountersSchema = z.record(z.string(), z.union([z.string(), z.number()]));

const ToolMetaSchema = z.object({
	redacted: z.boolean(),
	redactedFields: z.array(z.string()).optional(), // JSONpath ish
	sizeBytesApprox: z.number().min(0).optional(),
});

// Common to all audit events.
const AuditEnvelopeSchema = z.object({
	schema: z.literal("handlebar.audit.v1"),
	ts: z.preprocess((v) => {
		if (v instanceof Date) {
			return v;
		}
		if (typeof v === "string" || typeof v === "number") {
			return new Date(v);
		}
		return v;
	}, z.date()),
	runId: z.string(),
	stepIndex: z.number().min(0).optional(),
	decisionId: z.string().optional(),
	user: z
		.object({
			userId: z.string().optional(),
			userCategory: z.string().optional(),
			sessionId: z.string().optional(),
		})
		.optional(),
	otel: z
		.object({
			traceId: z.string().optional(),
			spanId: z.string().optional(),
		})
		.optional(),
	sample: z
		.object({
			rate: z.number().min(0).max(1).optional(),
			reason: z.string().optional(),
		})
		.optional(),
	redaction: z
		.object({
			level: z.enum(["none", "partial", "strict"]).optional(),
		})
		.optional(),
});

export const RunStartedEventSchema = AuditEnvelopeSchema.extend({
	kind: z.literal("run.started"),
	data: z.object({
		agent: z.object({
			framework: z.string().optional(),
			version: z.string().optional(),
			id: z.string().optional(),
			name: z.string().optional(),
		}),
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

export const ToolDecisionEventSchema = AuditEnvelopeSchema.extend({
	kind: z.literal("tool.decision"),
	data: GovernanceDecisionSchema.extend({
		tool: z.object({
			name: z.string(),
			categories: z.array(z.string()).optional(),
		}),
		counters: CountersSchema.optional(),
		latencyMs: z.number().min(0).optional(), // Time in governance
		argsMeta: ToolMetaSchema.optional(),
	}),
});

export const ToolResultEventSchema = AuditEnvelopeSchema.extend({
	kind: z.literal("tool.result"),
	data: z.object({
		tool: z.object({
			name: z.string(),
			categories: z.array(z.string()).optional(),
		}),
		outcome: z.enum(["success", "error"]),
		durationMs: z.number().min(0).optional(), // tool runtime
		counters: CountersSchema.optional(),
		error: z
			.object({
				name: z.string().optional(),
				message: z.string().optional(),
				stack: z.string().optional(),
			})
			.optional(),
		resultMeta: ToolMetaSchema.optional(),
	}),
});

export const RunEndedEventSchema = AuditEnvelopeSchema.extend({
	kind: z.literal("run.ended"),
	data: z.object({
		status: z.enum(["ok", "error", "blocked"]),
		totalSteps: z.number().min(0),
		firstErrorDecisionId: z.string().optional(),
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
]);

export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type AuditEventByKind = {
	[E in AuditEvent as E["kind"]]: E;
};
