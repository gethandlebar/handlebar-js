import {
	type Actor,
	type HandlebarClient,
	type ModelInfo,
	type RunConfig,
	withRun,
} from "@handlebar/core";
import { uuidv7 } from "uuidv7";
import { HandlebarCallbackHandler } from "./callback";
import { HandlebarTerminationError } from "./tool";

// Per-call run configuration — passed as the second argument to invoke().
export type RunCallOpts = {
	/** The user or system this request is acting on behalf of. */
	actor?: Actor;
	/** Session ID to group multiple runs together (e.g. a multi-turn conversation). */
	sessionId?: string;
	/** Arbitrary tags attached to this run for filtering / grouping. */
	tags?: Record<string, string>;
};

// Duck-typed executor interface — compatible with LangChain AgentExecutor and any Runnable.
// Typed loosely to avoid a hard dependency on the `langchain` package.
type RunnableExecutor = {
	invoke(
		input: Record<string, unknown>,
		options?: { callbacks?: unknown[] },
	): Promise<Record<string, unknown>>;
};

export type HandlebarAgentExecutorOpts = {
	/** Pre-initialised HandlebarClient. Use Handlebar.init(config) to create one. */
	hb: HandlebarClient;
	/**
	 * The LangChain AgentExecutor (or any compatible Runnable) to wrap.
	 * Tools should be pre-wrapped with wrapTools() before being added to the executor.
	 */
	executor: RunnableExecutor;
	/** Model info attached to run.started and llm.result events. */
	model: ModelInfo;
	/**
	 * Run config defaults applied to every run.
	 * runId, model, actor, sessionId, and tags are set automatically per call.
	 */
	runDefaults?: Omit<RunConfig, "runId" | "model" | "actor" | "sessionId" | "tags">;
};

/**
 * Wraps a LangChain AgentExecutor (or any compatible Runnable) with Handlebar governance.
 *
 * Responsibilities:
 * - Starts a Run for each invoke() call (emits run.started).
 * - Binds the Run in AsyncLocalStorage so wrapTools() can call beforeTool/afterTool.
 * - Attaches a HandlebarCallbackHandler to emit beforeLlm/afterLlm events per LLM step.
 * - Ends the Run on completion, error, or governance-triggered termination.
 *
 * @example
 * const tools = wrapTools([new SearchTool(), new CodeTool()], {
 *   toolTags: { search: ["read-only"] },
 * });
 * const agent = await createOpenAIToolsAgent(llm, tools, prompt);
 * const executor = AgentExecutor.fromAgentAndTools({ agent, tools });
 *
 * const hbExecutor = new HandlebarAgentExecutor({ hb, executor, model: { name: "gpt-4o", provider: "openai" } });
 * const result = await hbExecutor.invoke({ input: "..." }, { actor: { externalId: "user-123" } });
 */
export class HandlebarAgentExecutor {
	private readonly hb: HandlebarClient;
	private readonly executor: RunnableExecutor;
	private readonly model: ModelInfo;
	private readonly runDefaults:
		| Omit<RunConfig, "runId" | "model" | "actor" | "sessionId" | "tags">
		| undefined;

	constructor(opts: HandlebarAgentExecutorOpts) {
		this.hb = opts.hb;
		this.executor = opts.executor;
		this.model = opts.model;
		this.runDefaults = opts.runDefaults;
	}

	async invoke(
		input: Record<string, unknown>,
		callOpts?: RunCallOpts,
	): Promise<Record<string, unknown>> {
		const run = await this.hb.startRun({
			runId: uuidv7(),
			model: this.model,
			...this.runDefaults,
			actor: callOpts?.actor,
			sessionId: callOpts?.sessionId,
			tags: callOpts?.tags,
		});

		const handler = new HandlebarCallbackHandler(run, this.model);

		return withRun(run, async () => {
			try {
				const result = await this.executor.invoke(input, {
					callbacks: [handler],
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
