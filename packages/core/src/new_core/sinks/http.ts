import type { AuditEvent } from "@handlebar/governance-schema";
import type { HttpSinkConfig } from "../types";
import type { Sink } from "./types";

const DEFAULTS = {
	queueDepth: 500,
	flushIntervalMs: 1000,
	maxBatchSize: 50,
	flushTimeoutMs: 5000,
	maxRetries: 3,
	retryBaseMs: 500,
	retryCapMs: 10_000,
} as const;

type QueuedEvent = { agentId: string; event: AuditEvent };

export function createHttpSink(
	endpoint: string,
	apiKey: string | undefined,
	config?: Partial<HttpSinkConfig> & { _retryBaseMs?: number },
): Sink {
	const queueDepth = config?.queueDepth ?? DEFAULTS.queueDepth;
	const flushIntervalMs = config?.flushIntervalMs ?? DEFAULTS.flushIntervalMs;
	const maxBatchSize = config?.maxBatchSize ?? DEFAULTS.maxBatchSize;
	const flushTimeoutMs = config?.flushTimeoutMs ?? DEFAULTS.flushTimeoutMs;
	const retryBaseMs = config?._retryBaseMs ?? DEFAULTS.retryBaseMs;

	const queue: QueuedEvent[] = [];
	let timer: ReturnType<typeof setInterval> | null = null;
	let closed = false;
	// Serialises concurrent flush calls so we don't double-send.
	let flushInFlight: Promise<void> | null = null;

	function enqueue(agentId: string, event: AuditEvent): void {
    if (closed) { return; }
		if (queue.length >= queueDepth) {
			// Drop oldest to make room (back-pressure: prefer newest events).
			queue.shift();
		}
		queue.push({ agentId, event });
	}

	async function sendBatch(
		agentId: string,
		events: AuditEvent[],
	): Promise<void> {
		const url = `${endpoint}/v1/runs/events`;
		const headers: Record<string, string> = {
			"content-type": "application/json",
		};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

		let attempt = 0;
		while (attempt <= DEFAULTS.maxRetries) {
			try {
				const res = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify({ agentId, events }),
				});
        if (res.ok) { return; }
				// 4xx errors are not retryable (bad request / auth).
				if (res.status >= 400 && res.status < 500) {
					console.error(
						`[Handlebar] HttpSink: non-retryable ${res.status} from ${url}`,
					);
					return;
				}
				throw new Error(`HTTP ${res.status}`);
			} catch (err) {
				if (attempt === DEFAULTS.maxRetries) {
					console.error(
						`[Handlebar] HttpSink: giving up after ${attempt + 1} attempts:`,
						err,
					);
					return;
				}
				const backoffMs = Math.min(
					retryBaseMs * 2 ** attempt,
					DEFAULTS.retryCapMs,
				);
				await sleep(backoffMs);
				attempt++;
			}
		}
	}

	async function flush(): Promise<void> {
    if (queue.length === 0) { return; }

		// Drain the queue in batches, grouping by agentId.
		const snapshot = queue.splice(0, queue.length);
    const byAgent = new Map<string, AuditEvent[]>();

		for (const { agentId, event } of snapshot) {
			let bucket = byAgent.get(agentId);
			if (!bucket) {
				bucket = [];
				byAgent.set(agentId, bucket);
			}
			bucket.push(event);
		}

		const sends: Promise<void>[] = [];
		for (const [agentId, events] of byAgent) {
			for (let i = 0; i < events.length; i += maxBatchSize) {
				sends.push(sendBatch(agentId, events.slice(i, i + maxBatchSize)));
			}
		}
		await Promise.allSettled(sends);
	}

	function scheduleFlush(): void {
		flushInFlight = (flushInFlight ?? Promise.resolve())
			.then(() => flush())
			.catch((err) => console.error("[Handlebar] HttpSink flush error:", err));
	}

	return {
		init() {
			timer = setInterval(() => scheduleFlush(), flushIntervalMs);
			// Don't prevent process exit.
			if (typeof timer === "object" && timer !== null && "unref" in timer) {
				(timer as ReturnType<typeof setInterval> & { unref(): void }).unref();
			}
		},

		writeBatch(agentId: string, events: AuditEvent[]) {
			for (const event of events) {
				enqueue(agentId, event);
			}
		},

		async close() {
			closed = true;
			if (timer !== null) {
				clearInterval(timer);
				timer = null;
			}
			// Drain remaining events with a timeout.
			await Promise.race([flush(), sleep(flushTimeoutMs)]);
		},
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
