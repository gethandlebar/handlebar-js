import { z } from "zod";

// Common to all audit events.
export const AuditEnvelopeSchema = z.object({
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
  decisionId: z.string().optional(), // DEPRECATED.
  // ID of enduser the agent is acting on behalf of as present in the Handlebar user's system.
  // NOT the Handlebar ID for this enduser.
  enduserExternalId: z.string().optional(),
	// sessionId: z.string().optional(),
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
