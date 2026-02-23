import {
	type CustomCheck,
	FAILOPEN_DECISION,
	type GovernanceConfig,
	GovernanceEngine,
	type HandlebarClient,
	type HandlebarRunOpts,
	type ModelInfo,
	type RunConfig,
	type RunContext,
	type Tool as CoreTool,
	generateSlug,
	getCurrentRun,
	tokeniseCount,
	withRun,
	withRunContext,
} from "@handlebar/core";
import type { AgentTool } from "@handlebar/core/dist/api/types";
import type { MessageEventSchema } from "@handlebar/governance-schema";
import {
	Experimental_Agent as Agent,
	type Prompt,
	type StopCondition,
	type Tool,
	type ToolCallOptions,
	type ToolSet,
} from "ai";
import { uuidv7 } from "uuidv7";
import type { z } from "zod";
import { formatPrompt } from "./messages";

type MessageEvent = z.infer<typeof MessageEventSchema>;

// biome-ignore lint/suspicious/noExplicitAny: types need to be improved
type ToolSetBase = Record<string, Tool<any, any>>;

export type ToCoreTool<T extends ToolSetBase> = {
	// biome-ignore lint/suspicious/noExplicitAny: types need to be improved
	[K in keyof T]: T[K]["execute"] extends (...args: any) => any
		? CoreTool<
				K & string,
				Parameters<T[K]["execute"]>[0],
				Awaited<ReturnType<T[K]["execute"]>>
			>
		: CoreTool<K & string, unknown, unknown>;
}[keyof T];

export type HandlebarCheck<T extends ToolSetBase> = CustomCheck<ToCoreTool<T>>;

function mapTools<ToolSet extends ToolSetBase>(
	tools: ToolSet,
	wrap: <K extends keyof ToolSet & string>(
		name: K,
		t: ToolSet[K],
	) => ToolSet[K],
): ToolSet {
	// biome-ignore lint/suspicious/noExplicitAny: types need to be improved
	const out: Record<string, Tool<any, any>> = {};
	for (const name in tools) {
		out[name] = wrap(name as any, tools[name]);
	}
	return out as ToolSet;
}

// Response injected into tool output to signal the agent loop to stop.
// Detected by the stopWhen condition below.
const EXIT_RUN_CODE = "HANDLEBAR_EXIT_RUN";
const TOOL_BLOCK_CODE = "HANDLEBAR_TOOL_BLOCK";

type HandlebarAgentOpts<
	TOOLSET extends ToolSet,
	Ctx,
	Memory,
> = ConstructorParameters<typeof Agent<TOOLSET, Ctx, Memory>>[0] & {
	// ---------------------------------------------------------------------------
	// New core path (recommended)
	// ---------------------------------------------------------------------------
	// Pre-initialised HandlebarClient. Use Handlebar.init(config) to create one.
	hb?: HandlebarClient;
	// Run config overrides applied to each run started by this agent.
	runDefaults?: Omit<RunConfig, "runId">;
	// Per-tool tags for governance rule matching.
	toolTags?: Record<string, string[]>;

	// ---------------------------------------------------------------------------
	// Legacy path (deprecated — use hb instead)
	// ---------------------------------------------------------------------------
	/** @deprecated Use `hb` (HandlebarClient) instead. */
	governance?: Omit<GovernanceConfig<ToCoreTool<TOOLSET>>, "tools"> & {
		categories?: Record<string, string[]>;
	} & HandlebarRunOpts;
	/** @deprecated Pass agent config to Handlebar.init() instead. */
	agent?: {
		slug: string;
		name?: string;
		description?: string;
		tags?: string[];
	};
};

export class HandlebarAgent<
	const ToolSet extends ToolSetBase,
	Ctx = unknown,
	Memory = unknown,
> {
	private inner: Agent<ToolSet, Ctx, Memory>;

	// ---------------------------------------------------------------------------
	// New core state
	// ---------------------------------------------------------------------------
	private hb: HandlebarClient | undefined;
	private runDefaults: Omit<RunConfig, "runId"> | undefined;
	private readonly toolTagsMap: Record<string, string[]>;

	// ---------------------------------------------------------------------------
	// Legacy state (retained while governance path is in use)
	// ---------------------------------------------------------------------------
	/** @deprecated */
	public governance: GovernanceEngine<ToCoreTool<ToolSet>> | undefined;
	/** @deprecated */
	private runCtx: RunContext<ToCoreTool<ToolSet>> | undefined;
	private runStarted = false;
	private systemPrompt: string | undefined = undefined;
	private emittedSystemPrompt = false;
	private hasInitialisedEngine = false;
	private agentConfig:
		| { slug: string; name?: string; description?: string; tags?: string[] }
		| undefined;

	constructor(opts: HandlebarAgentOpts<ToolSet, Ctx, Memory>) {
		const {
			tools = {} as ToolSet,
			hb,
			runDefaults,
			toolTags = {},
			governance,
			agent,
			...rest
		} = opts;

		this.hb = hb;
		this.runDefaults = runDefaults;
		this.toolTagsMap = toolTags;
		this.agentConfig = agent;

		let wrapped: ToolSet;
		let stopWhen: StopCondition<NoInfer<ToolSet>>[];

		if (opts.stopWhen === undefined) {
			stopWhen = [];
		} else if (!Array.isArray(opts.stopWhen)) {
			stopWhen = [opts.stopWhen];
		} else {
			stopWhen = [...opts.stopWhen];
		}

		// Unified stop condition: detect EXIT_RUN_CODE in any tool output.
		stopWhen.push(({ steps }) => {
			const lastStep = steps[steps.length - 1];
			if (!lastStep) return false;
			for (const toolResult of lastStep.toolResults) {
				try {
					if (JSON.stringify(toolResult.output).includes(EXIT_RUN_CODE)) {
						return true;
					}
				} catch {}
			}
			return false;
		});

		if (hb) {
			// -----------------------------------------------------------------------
			// New core path: tools are wrapped using ALS — getCurrentRun() fetches
			// the run bound by withRun() in generate/stream/respond.
			// -----------------------------------------------------------------------
			wrapped = mapTools(tools, (name, t) => {
				if (!t.execute) return t;
				const exec = t.execute.bind(t);
				const tags = toolTags[name as string] ?? [];

				return {
					...t,
					async execute(args: unknown, options: ToolCallOptions) {
						const run = getCurrentRun();
						if (!run) {
							// No run bound — governance skipped (should not happen in normal flow).
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
							await run.afterTool(
								String(name),
								args,
								res,
								Date.now() - start,
								undefined,
								tags,
							);
							return res as never;
						} catch (e) {
							await run.afterTool(
								String(name),
								args,
								undefined,
								Date.now() - start,
								e,
								tags,
							);
							throw e;
						}
					},
				} as typeof t;
			});
		} else {
			// -----------------------------------------------------------------------
			// Legacy path: GovernanceEngine-based wrapping (deprecated).
			// -----------------------------------------------------------------------
			const toolMeta = (
				Object.keys(tools) as Array<keyof ToolSet & string>
			).map((name) => ({
				name,
				categories: governance?.categories?.[name] ?? [],
			}));

			const engine = new GovernanceEngine<ToCoreTool<ToolSet>>({
				tools: toolMeta,
				...governance,
			});

			let model: ModelInfo;
			if (typeof rest.model === "object") {
				const provider =
					rest.model.provider.split(".")[0] ?? rest.model.provider;
				model = { name: rest.model.modelId, provider };
			} else {
				const parts = rest.model.toString().split("/");
				model = {
					name: parts[parts.length - 1] ?? rest.model.toString(),
					provider: parts.length > 1 ? parts[0] : undefined,
				};
			}

			const runCtx = engine.createRunContext(uuidv7(), {
				enduser: governance?.enduser,
				model,
			});

			wrapped = mapTools(tools, (name, t) => {
				if (!t.execute) return t;
				const exec = t.execute.bind(t);

				return {
					...t,
					async execute(args: unknown, options: ToolCallOptions) {
						const decision = await engine.beforeTool(
							runCtx,
							String(name),
							args,
						);
						const handlebarResponse = engine.decisionAction(decision);
						if (handlebarResponse) return handlebarResponse;

						try {
							const start = Date.now();
							const res = await exec(args as never, options);
							await engine.afterTool(
								runCtx,
								String(name),
								Date.now() - start,
								args,
								res,
							);
							return res as never;
						} catch (e) {
							await engine.afterTool(
								runCtx,
								String(name),
								null,
								args,
								undefined,
								e,
							);
							throw e;
						}
					},
				} as typeof t;
			});

			this.governance = engine;
			this.runCtx = runCtx;
		}

		this.inner = new Agent<ToolSet, Ctx, Memory>({
			...rest,
			stopWhen,
			onStepFinish: async (step) => {
				if (this.hb) {
					// New core: emit LLM result via the run bound in ALS.
					const run = getCurrentRun();
					if (
						run &&
						(step.usage.inputTokens !== undefined ||
							step.usage.outputTokens !== undefined)
					) {
						const model = this.resolveModel(rest.model);
						await run.afterLlm({
							content: step.text ? [{ type: "text", text: step.text }] : [],
							model,
							usage: {
								inputTokens: step.usage.inputTokens,
								outputTokens: step.usage.outputTokens,
							},
						});
					}
				} else if (this.governance) {
					// Legacy path.
					try {
						const model = this.resolveModel(rest.model);
						this.governance.emitLLMResult(
							{
								inTokens: step.usage.inputTokens,
								outTokens: step.usage.outputTokens,
							},
							[],
							model,
						);
					} catch {}
				}

				if (rest.onStepFinish) {
					await rest.onStepFinish(step);
				}

				if (step.text.trim()) {
					this.emitMessage(step.text, "assistant", "output");
				}
			},
			tools: wrapped,
		});

		if (rest.system) {
			this.systemPrompt = rest.system;
		}
	}

	// ---------------------------------------------------------------------------
	// New core helpers
	// ---------------------------------------------------------------------------

	private resolveModel(
		model: HandlebarAgentOpts<ToolSet, Ctx, Memory>["model"],
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

	// ---------------------------------------------------------------------------
	// Legacy helpers
	// ---------------------------------------------------------------------------

	private toolInfo() {
		const infoTools: AgentTool[] = [];
		for (const name in this.inner.tools) {
			const tool = this.inner.tools[name];
			if (!tool) continue;
			infoTools.push({
				name,
				description: tool.description,
				key: `function:${name.toLowerCase().replaceAll(" ", "-")}`,
				version: 1,
				kind: "function",
			});
		}
		return infoTools;
	}

	/** @deprecated Only used in legacy governance path. */
	public async initEngine() {
		if (!this.governance || this.hasInitialisedEngine) return;
		await this.governance.initAgentRules(
			this.agentConfig ?? { slug: generateSlug() },
			this.toolInfo(),
		);
		this.hasInitialisedEngine = true;
	}

	private withRunLegacy<T>(fn: () => Promise<T> | T): Promise<T> | T {
		return withRunContext(
			{
				runId: this.runCtx!.runId,
				stepIndex: this.runCtx!.stepIndex,
				enduser: this.runCtx!.enduser,
			},
			async () => {
				if (!this.runStarted) {
					this.runStarted = true;
					this.governance!.emit("run.started", {
						agent: { framework: "ai-sdk" },
						model: this.runCtx!.model,
						adapter: { name: "@handlebar/ai-sdk-v5" },
						enduser: this.runCtx!.enduser,
					});
					this.maybeEmitSystemPrompt();
				}
				return fn();
			},
		);
	}

	private emitMessage(
		message: string,
		role: MessageEvent["data"]["role"],
		kind: MessageEvent["data"]["kind"],
	) {
		const messageCharLimit = 10000;
		const truncated = message.length > messageCharLimit;
		const messageFinal = truncated
			? message.slice(0, messageCharLimit)
			: message;

		// Emit via legacy engine if present, otherwise via current run in ALS.
		if (this.governance) {
			this.governance.emit("message.raw.created", {
				content: messageFinal,
				contentTruncated: truncated,
				role,
				kind,
				messageId: uuidv7(),
				debug: {
					approxTokens: tokeniseCount(messageFinal),
					chars: message.length,
				},
			});
		}
	}

	private maybeEmitSystemPrompt() {
		if (this.emittedSystemPrompt || this.systemPrompt === undefined) return;
		this.emitMessage(this.systemPrompt, "system", "observation");
		this.emittedSystemPrompt = true;
	}

	private emitMessages(prompts: Prompt[]) {
		for (const prompt of prompts) {
			for (const message of formatPrompt(prompt)) {
				if (message.role === "system") {
					this.systemPrompt = message.content;
					this.maybeEmitSystemPrompt();
				} else {
					this.emitMessage(
						message.content,
						message.role as MessageEvent["data"]["role"],
						message.kind,
					);
				}
			}
		}
	}

	/** @deprecated Only used in legacy governance path. */
	public with(opts: HandlebarRunOpts) {
		if (this.runCtx) {
			this.runCtx.enduser = opts.enduser;
		}
		return this;
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	async generate(
		...params: Parameters<Agent<ToolSet, Ctx, Memory>["generate"]>
	) {
		if (this.hb) {
			const run = await this.hb.startRun({
				runId: uuidv7(),
				...this.runDefaults,
			});
			return withRun(run, async () => {
				this.emitMessages(params);
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

		await this.initEngine();
		return this.withRunLegacy(() => {
			this.emitMessages(params);
			return this.inner.generate(...params);
		});
	}

	async stream(...params: Parameters<Agent<ToolSet, Ctx, Memory>["stream"]>) {
		if (this.hb) {
			const run = await this.hb.startRun({
				runId: uuidv7(),
				...this.runDefaults,
			});
			return withRun(run, async () => {
				this.emitMessages(params);
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

		await this.initEngine();
		return this.withRunLegacy(() => {
			this.emitMessages(params);
			return this.inner.stream(...params);
		});
	}

	async respond(...params: Parameters<Agent<ToolSet, Ctx, Memory>["respond"]>) {
		if (this.hb) {
			const run = await this.hb.startRun({
				runId: uuidv7(),
				...this.runDefaults,
			});
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

		await this.initEngine();
		return this.withRunLegacy(() => this.inner.respond(...params));
	}
}
