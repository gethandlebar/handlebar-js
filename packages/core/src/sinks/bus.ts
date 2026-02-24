import type { AuditEvent } from "@handlebar/governance-schema";
import type { Sink } from "./types";

// SinkBus fans out audit events to multiple sinks.
// Fire-and-forget: errors in individual sinks are caught and logged but do not propagate.
export class SinkBus {
	private sinks: Sink[] = [];
	private closed = false;

	add(...sinks: Sink[]): void {
		this.sinks.push(...sinks);
	}

	async init(): Promise<void> {
		await Promise.all(this.sinks.map((s) => s.init?.()));
	}

	// Emit a single event to all sinks.
	emit(agentId: string, event: AuditEvent): void {
		if (this.closed) return;
		for (const sink of this.sinks) {
			try {
				void sink.writeBatch(agentId, [event]);
			} catch (err) {
				console.error("[Handlebar] Sink error:", err);
			}
		}
	}

	async drain(): Promise<void> {
		await Promise.allSettled(this.sinks.map((s) => s.drain?.()));
	}

	async close(): Promise<void> {
		this.closed = true;
		await Promise.allSettled(this.sinks.map((s) => s.close?.()));
	}
}
