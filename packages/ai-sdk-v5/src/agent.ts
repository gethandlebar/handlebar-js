import {
	getCurrentRun,
	type HandlebarClient,
	type ModelInfo,
	type RunConfig,
	withRun,
} from "@handlebar/core";
import {
	Experimental_Agent as Agent,
	type StopCondition,
	type Tool,
	type ToolCallOptions,
	type ToolSet,
} from "ai";
import { uuidv7 } from "uuidv7";

// biome-ignore lint/suspicious/noExplicitAny: types need to be improved
type ToolSetBase = Record<string, Tool<any, any>>;

function mapTools<ToolSet extends ToolSetBase>(
	tools: ToolSet,
	wrap: <K extends keyof ToolSet & string>(name: K, t: ToolSet[K]) => ToolSet[K],
): ToolSet {
	// biome-ignore lint/suspicious/noExplicitAny: types need to be improved
	const out: Record<string, Tool<any, any>> = {};
	for (const name in tools) {
		out[name] = wrap(name as any, tools[name]);
	}
	return out as ToolSet;
}

// Injected into tool output to signal the agent loop to stop.
const EXIT_RUN_CODE = "HANDLEBAR_EXIT_RUN";
const TOOL_BLOCK_CODE = "HANDLEBAR_TOOL_BLOCK";

export type HandlebarAgentOpts<
	TOOLSET extends ToolSet,
	Ctx,
	Memory,
> = ConstructorParameters<typeof Agent<TOOLSET, Ctx, Memory>>[0] & {
	// Pre-initialised HandlebarClient. Use Handlebar.init(config) to create one.
	hb: HandlebarClient;
	// Run config overrides applied to each run started by this agent.
	// `runId` and `model` are set automatically and cannot be overridden here.
	runDefaults?: Omit<RunConfig, "runId" | "model">;
	// Per-tool tags for governance rule matching.
	toolTags?: Record<string, string[]>;
};

export class HandlebarAgent<
	const ToolSet extends ToolSetBase,
	Ctx = unknown,
	Memory = unknown,
> {
	private readonly inner: Agent<ToolSet, Ctx, Memory>;
	private readonly hb: HandlebarClient;
	private readonly model: ModelInfo;
	private readonly runDefaults: Omit<RunConfig, "runId" | "model"> | undefined;

	constructor(opts: HandlebarAgentOpts<ToolSet, Ctx, Memory>) {
		const { tools = {} as ToolSet, hb, runDefaults, toolTags = {}, ...rest } = opts;

		this.hb = hb;
		this.model = resolveModel(rest.model);
		this.runDefaults = runDefaults;

		let stopWhen: StopCondition<NoInfer<ToolSet>>[];
		if (opts.stopWhen === undefined) {
			stopWhen = [];
		} else if (!Array.isArray(opts.stopWhen)) {
			stopWhen = [opts.stopWhen];
		} else {
			stopWhen = [...opts.stopWhen];
		}

		// Detect EXIT_RUN_CODE in any tool output to stop the agent loop.
		stopWhen.push(({ steps }) => {
			const lastStep = steps[steps.length - 1];
			if (!lastStep) return false;
			for (const toolResult of lastStep.toolResults) {
				try {
					if (JSON.stringify(toolResult.output).includes(EXIT_RUN_CODE)) return true;
				} catch {}
			}
			return false;
		});

		const wrapped = mapTools(tools, (name, t) => {
			if (!t.execute) return t;
			const exec = t.execute.bind(t);
			const tags = toolTags[name as string] ?? [];

			return {
				...t,
				async execute(args: unknown, options: ToolCallOptions) {
					const run = getCurrentRun();
					if (!run) {
						// No run bound — should not happen in normal flow.
						return exec(args as never, options);
					}

					const decision = await run.beforeTool(String(name), args, tags);

					if (decision.verdict === "BLOCK") {
						if (decision.control === "TERMINATE") {
							return {
								code: EXIT_RUN_CODE,
								agentNextStep:
									"The tool call has violated Handlebar governance. The run will end. Do not reference Handlebar or rule violations in further commentary.",
								reason: decision.message,
							};
						}
						return {
							code: TOOL_BLOCK_CODE,
							agentNextStep:
								"The tool call has violated Handlebar governance and has been blocked. Do not reference Handlebar or rule violations in further commentary.",
							reason: decision.message,
						};
					}

					const start = Date.now();
					try {
						const res = await exec(args as never, options);
						await run.afterTool(String(name), args, res, Date.now() - start, undefined, tags);
						return res as never;
					} catch (e) {
						await run.afterTool(String(name), args, undefined, Date.now() - start, e, tags);
						throw e;
					}
				},
			} as typeof t;
		});

		this.inner = new Agent<ToolSet, Ctx, Memory>({
			...rest,
			stopWhen,
			onStepFinish: async (step) => {
				const run = getCurrentRun();
				if (run && (step.usage.inputTokens !== undefined || step.usage.outputTokens !== undefined)) {
					await run.afterLlm({
						content: step.text ? [{ type: "text", text: step.text }] : [],
						model: this.model,
						usage: {
							inputTokens: step.usage.inputTokens,
							outputTokens: step.usage.outputTokens,
						},
					});
				}

				if (rest.onStepFinish) {
					await rest.onStepFinish(step);
				}
			},
			tools: wrapped,
		});
	}

	private startRun() {
		return this.hb.startRun({
			runId: uuidv7(),
			model: this.model,
			...this.runDefaults,
		});
	}

	async generate(...params: Parameters<Agent<ToolSet, Ctx, Memory>["generate"]>) {
		const run = await this.startRun();
		return withRun(run, async () => {
			try {
				const result = await this.inner.generate(...params);
				await run.end("success");
				return result;
			} catch (e) {
				await run.end("error");
				throw e;
			}
		});
	}

	async stream(...params: Parameters<Agent<ToolSet, Ctx, Memory>["stream"]>) {
		const run = await this.startRun();
		return withRun(run, async () => {
			try {
				const result = await this.inner.stream(...params);
				await run.end("success");
				return result;
			} catch (e) {
				await run.end("error");
				throw e;
			}
		});
	}

	async respond(...params: Parameters<Agent<ToolSet, Ctx, Memory>["respond"]>) {
		const run = await this.startRun();
		return withRun(run, async () => {
			try {
				const result = await this.inner.respond(...params);
				await run.end("success");
				return result;
			} catch (e) {
				await run.end("error");
				throw e;
			}
		});
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveModel(
	model: ConstructorParameters<typeof Agent>[0]["model"],
): ModelInfo {
	if (typeof model === "object") {
		const provider = model.provider.split(".")[0] ?? model.provider;
		return { name: model.modelId, provider };
	}
	const parts = model.toString().split("/");
	return {
		name: parts[parts.length - 1] ?? model.toString(),
		provider: parts.length > 1 ? parts[0] : undefined,
	};
}
