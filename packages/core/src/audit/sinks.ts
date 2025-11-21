import type { AuditEvent } from "@handlebar/governance-schema";
import type { AuditSink } from "./bus";

export function ConsoleSink(mode: "pretty" | "json" = "json"): AuditSink {
	return {
		write(e) {
			if (mode === "json") {
				console.log(JSON.stringify(e));
			} else {
				console.log(
					`[${e.kind}] run=${e.runId} step=${e.stepIndex ?? "-"} ${e.data ? "" : ""}`,
				);
			}
		},
	};
}

export function FileSink(path: string): AuditSink {
	let fh: any;
	return {
		async init() {
			fh = await import("node:fs").then((m) =>
				m.createWriteStream(path, { flags: "a" }),
			);
		},
		write(e) {
			fh?.write(`${JSON.stringify(e)}\n`);
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
		async write(e: AuditEvent) {
			// fire and forget
			fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json", ...headers },
				body: JSON.stringify(e),
			}).catch(() => {});
		},
	};
}
