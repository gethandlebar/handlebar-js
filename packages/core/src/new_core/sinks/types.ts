import type { AuditEvent } from "@handlebar/governance-schema";

// A sink receives audit events and writes them somewhere.
export interface Sink {
	// Called once before the sink is used. Async-safe — await init before writing.
	init?(): Promise<void> | void;
	// Write a batch of events. May be called concurrently; implementations must be safe.
	writeBatch(agentId: string, events: AuditEvent[]): Promise<void> | void;
	// Flush pending writes and release resources.
	close?(): Promise<void>;
}
