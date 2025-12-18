import type { AuditEvent } from "@handlebar/governance-schema";
import type { AuditSink } from "./bus";

export function ConsoleSink(mode: "pretty" | "json" = "json"): AuditSink {
	return {
		write(agentId, e) {
			if (mode === "json") {
				console.log(JSON.stringify(e));
			} else {
				console.log(
					`[${e.kind}] agent=${agentId} run=${e.runId} step=${e.stepIndex ?? "-"} ${e.data ? "" : ""}`,
				);
			}
		},
	};
}

export function FileSink(path: string): AuditSink {
	// biome-ignore lint/suspicious/noExplicitAny: WIP. Not in use currently.
	let fh: any;
	return {
		async init() {
			fh = await import("node:fs").then((m) =>
				m.createWriteStream(path, { flags: "a" }),
			);
		},
		write(agentId, e) {
			fh?.write(`${JSON.stringify({ agentId, ...e })}\n`);
		},
		async close() {
			await new Promise((res) => fh?.end(res));
		},
	};
}

/**
 * Basic Http sink.
 *
 * Needs auth, retry, backoff.
 */
export function HttpSink(
	endpoint: string,
	headers: Record<string, string> = {},
): AuditSink {
	return {
		async write(agentId, e: AuditEvent) {
			console.debug(`[Handlebar] writing to ${endpoint}`);
			// fire and forget
			fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json", ...headers },
				body: JSON.stringify({ agentId, events: [e] }),
			}).catch((e) => {
				console.error(`Error firing audit events to ${endpoint}: ${e}`);
			});
		},
	};
}
