import type { Id, ISO8601 } from "../types";
import type { AuditBus } from "./bus";
import { getRunContext } from "./context";
import { Telemetry } from "./telemetry";
import type { AuditEvent } from "./types";


const now = (): ISO8601 => new Date().toISOString(); // TODO: move to utils.

// TODO: generic typing of audit event data
export function emit(kind: AuditEvent["kind"], data: any, extras?: Partial<AuditEvent>) {
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
    ...(extras ?? {})
  } as AuditEvent;

  Telemetry.bus()?.emit(event);
}


/**
 * @deprecated - Initial design. probably should remove before merge.
 */
export function makeEmitters(bus: AuditBus, common: {
  runId: Id; userCategory?: string; sessionId?: string; orgId?: string; projectId?: string;
  otel?: { traceId?: string; spanId?: string };
  redaction?: { level?: "none"|"partial"|"strict" };
}) {
  function emit<E extends AuditEvent>(ev: E) { bus.emit(ev); }

  return {
    runStarted(data: AuditEvent["data"]) {
      emit({ schema:"handlebar.audit.v1", kind:"run.started", ts: now(), runId: common.runId, userCategory: common.userCategory, sessionId: common.sessionId, orgId: common.orgId, projectId: common.projectId, otel: common.otel, redaction: common.redaction, data } as AuditEvent);
    },
    toolDecision(stepIndex: number, decisionId: Id, data: AuditEvent["data"]) {
      emit({ schema:"handlebar.audit.v1", kind:"tool.decision", ts: now(), runId: common.runId, stepIndex, decisionId, userCategory: common.userCategory, otel: common.otel, redaction: common.redaction, data } as AuditEvent);
    },
    toolResult(stepIndex: number, decisionId: Id, data: AuditEvent["data"]) {
      emit({ schema:"handlebar.audit.v1", kind:"tool.result", ts: now(), runId: common.runId, stepIndex, decisionId, userCategory: common.userCategory, otel: common.otel, redaction: common.redaction, data } as AuditEvent);
    },
    runEnded(data: AuditEvent["data"]) {
      emit({ schema:"handlebar.audit.v1", kind:"run.ended", ts: now(), runId: common.runId, userCategory: common.userCategory, otel: common.otel, redaction: common.redaction, data } as AuditEvent);
    },
    error(data: AuditEvent["data"]) {
      emit({ schema:"handlebar.audit.v1", kind:"error", ts: now(), runId: common.runId, userCategory: common.userCategory, otel: common.otel, redaction: common.redaction, data } as AuditEvent);
    }
  };
}
