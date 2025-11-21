import type { AuditEvent, AuditEventByKind } from "@handlebar/governance-schema";
import { now } from "../utils";
import { getRunContext } from "./context";
import { Telemetry } from "./telemetry";

export function emit<K extends AuditEvent["kind"]>(
	kind: K,
	data: AuditEventByKind[K]["data"],
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
