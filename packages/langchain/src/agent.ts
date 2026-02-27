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

/**
 * Structural type for any agent or chain with an invoke method.
 * Accepts both @langchain/core Runnable subclasses and other agent implementations
 * (e.g. ReactAgent from the `langchain` package) that share the same invoke signature
 * but do not extend @langchain/core's Runnable directly.
 */
export type AnyAgent = {
	// biome-ignore lint/suspicious/noExplicitAny: intentionally broad for cross-framework compatibility
	invoke(input: any, config?: any): Promise<any>;
};

// Handlebar-specific per-call options - passed via RunnableConfig.configurable.
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
	 * The LangChain AgentExecutor (or any compatible Runnable or ReactAgent) to wrap.
	 * Tools should be pre-wrapped with wrapTools() before being added to the executor.
	 */
	agent: AnyAgent;
	/** Model info attached to run.started and llm.result events. Optional — LLM result events are skipped if omitted. */
	model?: ModelInfo;
	/**
	 * Run config defaults applied to every run.
	 * runId, model, actor, sessionId, and tags are set automatically per call.
	 */
	runDefaults?: Omit<
		RunConfig,
		"runId" | "model" | "actor" | "sessionId" | "tags"
	>;
};

/**
 * Wraps a LangChain Runnable (AgentExecutor, compiled LangGraph state graph, or any chain)
 * with Handlebar governance. Extends Runnable so it can be composed in LangChain chains via .pipe().
 *
 * Handlebar-specific options (actor, sessionId, tags) are passed via
 * RunnableConfig.configurable so they flow naturally through LangChain's config
 * propagation system.
 *
 * @example
 * // Direct invocation with an AgentExecutor
 * const hbExecutor = new HandlebarAgentExecutor({ hb, agent: executor, model });
 * const result = await hbExecutor.invoke({ input: "..." });
 *
 * @example
 * // Direct invocation with a LangGraph agent (messages-based)
 * const hbExecutor = new HandlebarAgentExecutor({ hb, agent });
 * const result = await hbExecutor.invoke(
 *   { messages: [{ role: "user", content: "..." }] },
 *   { configurable: { actor: { externalId: "user-123" } } },
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
	private readonly executor: AnyAgent;
	private readonly model: ModelInfo | undefined;
	private readonly runDefaults:
		| Omit<RunConfig, "runId" | "model" | "actor" | "sessionId" | "tags">
		| undefined;

	constructor(opts: HandlebarAgentExecutorOpts) {
		super();
		this.hb = opts.hb;
		this.executor = opts.agent;
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
		// When used in a .pipe() chain, LangChain passes callbacks via config - preserve them.
		const existingCbs = Array.isArray(config?.callbacks)
			? config.callbacks
			: [];

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
