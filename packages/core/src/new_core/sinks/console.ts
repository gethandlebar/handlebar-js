import type { AuditEvent } from "@handlebar/governance-schema";
import type { ConsoleSinkConfig } from "../types";
import type { Sink } from "./types";

export function createConsoleSink(config?: Pick<ConsoleSinkConfig, "format">): Sink {
	const format = config?.format ?? "json";
	return {
		writeBatch(_agentId: string, events: AuditEvent[]) {
			for (const event of events) {
				if (format === "json") {
					console.log(JSON.stringify(event));
				} else {
					console.log(
						`[handlebar] ${event.kind} run=${event.runId} step=${event.stepIndex ?? "-"}`,
					);
				}
			}
		},
	};
}
