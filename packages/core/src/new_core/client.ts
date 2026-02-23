import { AsyncLocalStorage } from "node:async_hooks";
import { ApiManager } from "./api/manager";
import { Run } from "./run";
import { SinkBus } from "./sinks/bus";
import { createConsoleSink } from "./sinks/console";
import { createHttpSink } from "./sinks/http";
import type { HandlebarConfig, RunConfig, SinkConfig, Tool } from "./types";

// AsyncLocalStorage for implicit run propagation.
// Used by framework wrappers that cannot pass `run` explicitly.
// The explicit run.hook() API is the primary contract; ALS is a convenience layer.
const runStorage = new AsyncLocalStorage<Run>();

// Wrap an async function so the given run is accessible via getCurrentRun() within it.
export function withRun<T>(run: Run, fn: () => Promise<T>): Promise<T> {
	return runStorage.run(run, fn);
}

// Get the run currently bound via withRun() in the current async context.
// Returns undefined if no run is bound.
export function getCurrentRun(): Run | undefined {
	return runStorage.getStore();
}

export class HandlebarClient {
	private readonly config: HandlebarConfig;
	private readonly api: ApiManager;
	private readonly bus: SinkBus;
	private agentId: string | null = null;
	// Tracks active runs by runId for idempotent startRun.
	private readonly activeRuns = new Map<string, Run>();
	// Resolves once init() completes (agent upsert + tool registration).
	private initPromise: Promise<void> | null = null;

	private constructor(config: HandlebarConfig) {
		this.config = config;
		this.api = new ApiManager({
			apiKey: config.apiKey,
			apiEndpoint: config.apiEndpoint,
			failClosed: config.failClosed,
		});
		this.bus = new SinkBus();
	}

	// ---------------------------------------------------------------------------
	// Factory — always use Handlebar.init(), not new HandlebarClient()
	// ---------------------------------------------------------------------------

	static async init(config: HandlebarConfig): Promise<HandlebarClient> {
		const client = new HandlebarClient(config);
		await client.initSinks(config.sinks);
		client.initPromise = client.initAgent(config);
		// Kick off the async init but don't block — callers can await readyOrFail() if needed.
		client.initPromise.catch((err) =>
			console.error("[Handlebar] Async init error:", err),
		);
		return client;
	}

	// Await this if you need to be certain agent registration is complete before proceeding.
	async ready(): Promise<void> {
		await this.initPromise;
	}

	// ---------------------------------------------------------------------------
	// Tool registration (for tools added after init)
	// ---------------------------------------------------------------------------

	async registerTools(tools: Tool[]): Promise<void> {
		await this.initPromise; // wait for agent upsert to complete
		if (this.agentId) {
			await this.api.registerTools(this.agentId, tools);
		}
	}

	// ---------------------------------------------------------------------------
	// Run management
	// ---------------------------------------------------------------------------

	// Start a new run. If a run with the same runId is already active, returns it (idempotent).
	async startRun(config: RunConfig): Promise<Run> {
		await this.initPromise; // ensure agentId is resolved

		// Idempotency: same runId → same run.
		const existing = this.activeRuns.get(config.runId);
    if (existing && !existing.isEnded) {
      return existing;
    }

		// Check lockdown by starting the run on the server.
		const lockdown = await this.api.startRun(config.runId, this.agentId ?? "", {
			sessionId: config.sessionId,
			actorExternalId: config.actor?.externalId,
		});

		if (lockdown.active) {
			console.warn(
				`[Handlebar] Agent is under lockdown${lockdown.reason ? `: ${lockdown.reason}` : ""}`,
			);
			// On lockdown: if failClosed, create a "locked down" run that blocks all tool calls.
			// If failOpen, create a run that proceeds normally (shadow logging only).
			// For now: emit a warning and continue; callers can check lockdown status themselves.
		}

		const run = new Run({
			runConfig: config,
			agentId: this.agentId,
			enforceMode: this.config.enforceMode ?? "enforce",
			failClosed: this.config.failClosed ?? false,
			api: this.api,
			bus: this.bus,
		});

		this.activeRuns.set(config.runId, run);
		return run;
	}

	// Flush all pending audit events and release resources.
	async shutdown(): Promise<void> {
		await this.bus.close();
	}

	// ---------------------------------------------------------------------------
	// Private
	// ---------------------------------------------------------------------------

	private async initSinks(sinks?: SinkConfig[]): Promise<void> {
		if (!sinks || sinks.length === 0) {
			// Default: HTTP sink to Handlebar API.
			const endpoint =
				this.config.apiEndpoint ?? "https://api.gethandlebar.com";
			this.bus.add(createHttpSink(endpoint, this.config.apiKey));
		} else {
			for (const sinkConfig of sinks) {
				if (sinkConfig.type === "console") {
					this.bus.add(createConsoleSink({ format: sinkConfig.format }));
				} else if (sinkConfig.type === "http") {
					const endpoint =
						sinkConfig.endpoint ??
						this.config.apiEndpoint ??
						"https://api.gethandlebar.com";
					const apiKey = sinkConfig.apiKey ?? this.config.apiKey;
					this.bus.add(createHttpSink(endpoint, apiKey, sinkConfig));
				}
			}
		}
		await this.bus.init();
	}

	private async initAgent(config: HandlebarConfig): Promise<void> {
		const agentId = await this.api.upsertAgent(config.agent, config.tools);
		this.agentId = agentId;
	}
}

// Convenience factory — mirrors the spec's `Handlebar.init(config)` call.
export const Handlebar = {
	init: HandlebarClient.init.bind(HandlebarClient),
};
