import type { AuditEvent } from "./types";

export interface AuditSink {
  init?(): Promise<void> | void;
  write(event: AuditEvent): Promise<void> | void;
  flush?(): Promise<void> | void;
  close?(): Promise<void> | void;
}

export interface AuditBus {
  emit(event: AuditEvent): void;            // fire-and-forget
  use(...sinks: AuditSink[]): void;         // register sinks
  shutdown(): Promise<void>;                // flush & close
}

export function createAuditBus(): AuditBus {
  const sinks: AuditSink[] = [];
  let closed = false;

  return {
    use(...s) { sinks.push(...s); },
    emit(e) {
      if (closed) { return; }
      for (const s of sinks) {
        try { void s.write(e); } catch (_) { /* don't throw from telemetry */ }
      }
    },
    async shutdown() {
      closed = true;
      for (const s of sinks) { try { await s.flush?.(); await s.close?.(); } catch {} }
    }
  };
}
