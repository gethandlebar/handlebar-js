import {
	type Actor,
	type HandlebarClient,
	type ModelInfo,
	type RunConfig,
	withRun,
} from "@handlebar/core";
import { Runnable, type RunnableConfig } from "@langchain/core/runnables";
import { uuidv7 } from "uuidv7";
import { HandlebarCallbackHandler } from "./callback";
import { HandlebarTerminationError } from "./tool";

// Handlebar-specific per-call options — passed via RunnableConfig.configurable.
export type RunCallOpts = {
	/** The user or system this request is acting on behalf of. */
	actor?: Actor;
	/** Session ID to group multiple runs together (e.g. a multi-turn conversation). */
	sessionId?: string;
	/** Arbitrary tags attached to this run for filtering / grouping. */
	tags?: Record<string, string>;
};

export type HandlebarConfig = RunnableConfig & {
	configurable?: RunCallOpts;
};

export type HandlebarAgentExecutorOpts = {
	/** Pre-initialised HandlebarClient. Use Handlebar.init(config) to create one. */
	hb: HandlebarClient;
	/**
	 * The LangChain AgentExecutor (or any compatible Runnable) to wrap.
	 * Tools should be pre-wrapped with wrapTools() before being added to the executor.
	 */
	executor: Runnable<Record<string, unknown>, Record<string, unknown>>;
	/** Model info attached to run.started and llm.result events. */
	model: ModelInfo;
	/**
	 * Run config defaults applied to every run.
	 * runId, model, actor, sessionId, and tags are set automatically per call.
	 */
	runDefaults?: Omit<RunConfig, "runId" | "model" | "actor" | "sessionId" | "tags">;
};

/**
 * Wraps a LangChain Runnable (AgentExecutor or any chain) with Handlebar governance.
 * Extends Runnable so it can be composed in LangChain chains via .pipe().
 *
 * Handlebar-specific options (actor, sessionId, tags) are passed via
 * RunnableConfig.configurable so they flow naturally through LangChain's config
 * propagation system.
 *
 * @example
 * // Direct invocation
 * const result = await hbExecutor.invoke(
 *   { input: "..." },
 *   { configurable: { actor: { externalId: "user-123" }, sessionId: "s-1" } },
 * );
 *
 * @example
 * // In a chain
 * const chain = preprocess.pipe(hbExecutor).pipe(postprocess);
 * await chain.invoke({ input: "..." }, { configurable: { actor: { externalId: "user-123" } } });
 */
export class HandlebarAgentExecutor extends Runnable<
	Record<string, unknown>,
	Record<string, unknown>
> {
	lc_namespace = ["handlebar", "langchain"];

	private readonly hb: HandlebarClient;
	private readonly executor: Runnable<Record<string, unknown>, Record<string, unknown>>;
	private readonly model: ModelInfo;
	private readonly runDefaults:
		| Omit<RunConfig, "runId" | "model" | "actor" | "sessionId" | "tags">
		| undefined;

	constructor(opts: HandlebarAgentExecutorOpts) {
		super();
		this.hb = opts.hb;
		this.executor = opts.executor;
		this.model = opts.model;
		this.runDefaults = opts.runDefaults;
	}

	async invoke(
		input: Record<string, unknown>,
		config?: HandlebarConfig,
	): Promise<Record<string, unknown>> {
		const callOpts = config?.configurable;
		const run = await this.hb.startRun({
			runId: uuidv7(),
			model: this.model,
			...this.runDefaults,
			actor: callOpts?.actor,
			sessionId: callOpts?.sessionId,
			tags: callOpts?.tags,
		});

		const handler = new HandlebarCallbackHandler(run, this.model);

		// Merge our callback handler with any existing callbacks from the parent chain.
		// When used in a .pipe() chain, LangChain passes callbacks via config — preserve them.
		const existingCbs = Array.isArray(config?.callbacks) ? config.callbacks : [];

		return withRun(run, async () => {
			try {
				const result = await this.executor.invoke(input, {
					...config,
					callbacks: [handler, ...existingCbs],
				});
				await run.end("success");
				return result;
			} catch (err) {
				if (err instanceof HandlebarTerminationError) {
					await run.end("interrupted");
					throw err;
				}
				await run.end("error");
				throw err;
			}
		});
	}
}
