import z from "zod";
import type { AppliedAction, GovernanceCode, GovernanceEffect } from "./governance-actions";

type Id = string;
export type ISO8601 = string; // date string

export type AuditEvent =
	| RunStartedEvent
	| ToolDecisionEvent
	| ToolResultEvent
	| RunEndedEvent
	| ErrorEvent;

export const AuditEventSchema = z.custom<AuditEvent>();


export type AuditEventByKind = {
	[E in AuditEvent as E["kind"]]: E;
};

/** Common to all audit events */
export interface AuditEnvelope<TKind extends string, TData> {
	schema: "handlebar.audit.v1";
	kind: TKind;
	ts: ISO8601;

	runId: Id; // stable for the whole agent run
	stepIndex?: number; // tool step
	decisionId?: Id; // pairing decision and result

	user?: {
		userId?: string;
		userCategory?: string;
		sessionId?: string; // caller’s session/chat id, as defined by user
	};

	otel?: { traceId?: string; spanId?: string };

	sample?: { rate?: number; reason?: string };
	redaction?: { level?: "none" | "partial" | "strict" };

	data: TData;
}

export type RunStartedEvent = AuditEnvelope<
	"run.started",
	{
		agent: { framework?: string; version?: string; id?: string; name?: string };
		model?: { provider?: string; name?: string };
		adapter?: { name: string; version?: string }; // Handlebar adapter/SDK.
		policy?: { version?: string; ruleCount?: number; sequenceId?: string };
		request?: { id?: string; traceparent?: string }; //  external correlation (e.g., HTTP request)
	}
>;

export type RuleProofNode = {
	id?: string; // rule or predicate id
	passed: boolean;
	reason?: string; // optional human-readable
	children?: RuleProofNode[]; // for AND/OR trees
};

export type ToolDecisionEvent = AuditEnvelope<
	"tool.decision",
	{
		tool: { name: string; categories?: string[] };
		decision: {
			effect: GovernanceEffect;
			code: GovernanceCode;
			reason?: string;
		};
		matchedRuleIds: string[]; // All rules whose conditions evaluated true for this call.
		appliedActions: AppliedAction[]; // Concrete actions the engine derived from the rules.

		proof?: RuleProofNode; // optional compact decision tree
		counters?: Record<string, number>;
		argsMeta?: {
			redacted: boolean;
			redactedFields?: string[]; // JSONPath-ish
			sizeBytesApprox?: number;
		};
		latencyMs?: number; // time spent in governance before execution
	}
>;

export type ToolResultEvent = AuditEnvelope<
	"tool.result",
	{
		tool: { name: string; categories?: string[] };
		outcome: "success" | "error";
		durationMs?: number; // tool runtime
		inputBytes?: number;
		outputBytes?: number;
		counters?: Record<string, number>; // updated counters after accounting
		error?: { name?: string; message?: string; stack?: string };
		resultMeta?: {
			redacted: boolean;
			redactedFields?: string[];
			sizeBytesApprox?: number;
		};
	}
>;

export type RunEndedEvent = AuditEnvelope<
	"run.ended",
	{
		status: "ok" | "error" | "blocked";
		totalSteps?: number;
		firstErrorDecisionId?: Id;
		summary?: string;
	}
>;

export type ErrorEvent = AuditEnvelope<
	"error",
	{
		scope: "governance" | "adapter" | "transport";
		message: string;
		details?: Record<string, unknown>;
		fatal?: boolean;
	}
>;
