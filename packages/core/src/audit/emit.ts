import type { Id, ISO8601 } from "../types";
import type { AuditBus } from "./bus";
import { getRunContext } from "./context";
import { Telemetry } from "./telemetry";
import type { AuditEvent } from "./types";

const now = (): ISO8601 => new Date().toISOString(); // TODO: move to utils.

// TODO: generic typing of audit event data
export function emit(
	kind: AuditEvent["kind"],
	data: any,
	extras?: Partial<AuditEvent>,
) {
	const ctx = getRunContext();
	if (!ctx?.runId) {
		// TODO: log if no run ID.
		return;
	}

	const event: AuditEvent = {
		schema: "handlebar.audit.v1",
		kind,
		ts: now(),
		runId: ctx.runId,
		stepIndex: ctx.stepIndex,
		decisionId: ctx.decisionId,
		otel: ctx.otel,
		data,
		...(extras ?? {}),
	} as AuditEvent;

	Telemetry.bus()?.emit(event);
}
