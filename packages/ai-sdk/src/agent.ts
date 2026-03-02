import {
	type Actor,
	getCurrentRun,
	type HandlebarClient,
	type LLMMessage,
	type ModelInfo,
	type RunConfig,
	withRun,
} from "@handlebar/core";
import {
	ToolLoopAgent,
	type AgentCallParameters,
	type AgentStreamParameters,
	type ContentPart,
	type StopCondition,
	type Tool,
	type ToolExecutionOptions,
	type ToolLoopAgentSettings,
	type ToolSet,
} from "ai";
import { uuidv7 } from "uuidv7";
import { modelMessageToLlmMessage } from "./messages";
import { HANDLEBAR_TAGS } from "./tool";

// biome-ignore lint/suspicious/noExplicitAny: intentional loose base
function resolveToolTags(t: Tool<any, any>, fallback: string[] | undefined): string[] {
	const attached = (t as Record<symbol, unknown>)[HANDLEBAR_TAGS];
	if (Array.isArray(attached)) return attached;
	return fallback ?? [];
}

// biome-ignore lint/suspicious/noExplicitAny: intentional loose base
type ToolSetBase = Record<string, Tool<any, any>>;

function mapTools<T extends ToolSetBase>(
	tools: T,
	wrap: <K extends keyof T & string>(name: K, t: T[K]) => T[K],
): T {
	// biome-ignore lint/suspicious/noExplicitAny: intentional
	const out: Record<string, Tool<any, any>> = {};
	for (const name in tools) {
		out[name] = wrap(name, tools[name]);
	}
	return out as T;
}

// Injected into tool output to signal the agent loop to stop.
const EXIT_RUN_CODE = "HANDLEBAR_EXIT_RUN";
const TOOL_BLOCK_CODE = "HANDLEBAR_TOOL_BLOCK";

// Per-call run configuration.
export type RunCallOpts = {
	actor?: Actor;
	sessionId?: string;
	tags?: Record<string, string>;
};

// ToolLoopAgentSettings without `output` — structured output doesn't interact
// with governance and exposes an unimportable namespace type in ai@6.
type AgentSettings<CALL_OPTIONS, TOOLS extends ToolSet> = Omit<
	ToolLoopAgentSettings<CALL_OPTIONS, TOOLS, never>,
	"output"
>;

export type HandlebarAgentOpts<
	TOOLS extends ToolSet,
	CALL_OPTIONS = never,
> = AgentSettings<CALL_OPTIONS, TOOLS> & {
	// Pre-initialised HandlebarClient. Use Handlebar.init(config) to create one.
	hb: HandlebarClient;
	// Run config defaults applied to every run started by this agent.
	// `runId` and `model` are set automatically and cannot be overridden here.
	runDefaults?: Omit<
		RunConfig,
		"runId" | "model" | "actor" | "sessionId" | "tags"
	>;
	// Per-tool tags for governance rule matching.
	toolTags?: Record<string, string[]>;
};

export class HandlebarAgent<
	const TOOLS extends ToolSetBase,
	CALL_OPTIONS = never,
> {
	private readonly inner: ToolLoopAgent<CALL_OPTIONS, TOOLS, never>;
	private readonly hb: HandlebarClient;
	private readonly toolMeta: Array<{
		name: string;
		description?: string;
		tags?: string[];
	}>;
	private hasRegisteredTools = false;
	private readonly model: ModelInfo;
	private readonly runDefaults:
		| Omit<RunConfig, "runId" | "model" | "actor" | "sessionId" | "tags">
		| undefined;

	constructor(opts: HandlebarAgentOpts<TOOLS, CALL_OPTIONS>) {
		const {
			tools = {} as TOOLS,
			hb,
			runDefaults,
			toolTags = {},
			...rest
		} = opts;

		this.hb = hb;
		this.model = resolveModel(rest.model);
		this.runDefaults = runDefaults;

		// Collect tool metadata for registration with the Handlebar API.
		// Tags come from the tool itself (via our `tool()` wrapper) with toolTags as fallback.
		this.toolMeta = [];
		for (const name in tools) {
			const t = tools[name];
			if (t === undefined) continue;
			this.toolMeta.push({
				name,
				description: t.description,
				tags: resolveToolTags(t, toolTags[name]),
			});
		}

		// Build stopWhen: preserve caller's condition(s) and add EXIT_RUN_CODE detector.
		let stopWhen: StopCondition<NoInfer<TOOLS>>[];
		if (opts.stopWhen === undefined) {
			stopWhen = [];
		} else if (!Array.isArray(opts.stopWhen)) {
			stopWhen = [opts.stopWhen];
		} else {
			stopWhen = [...opts.stopWhen];
		}

		stopWhen.push(({ steps }) => {
			const lastStep = steps[steps.length - 1];
			if (!lastStep) return false;
			for (const toolResult of lastStep.toolResults) {
				try {
					if (JSON.stringify(toolResult.output).includes(EXIT_RUN_CODE))
						return true;
				} catch {}
			}
			return false;
		});

		// Tracks how many messages have already been emitted per run so prepareStep
		// only forwards the *new* messages on each step (not the full accumulated history).
		const msgCountByRun = new Map<string, number>();

		const wrapped = mapTools(tools, (name, t) => {
			if (!t.execute) return t;
			const exec = t.execute.bind(t);
			const tags = resolveToolTags(t, toolTags[name as string]);

			return {
				...t,
				async execute(args: unknown, options: ToolExecutionOptions) {
					const run = getCurrentRun();
					if (!run) {
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

		this.inner = new ToolLoopAgent<CALL_OPTIONS, TOOLS, never>({
			...rest,
			stopWhen,
			prepareStep: async (stepOpts) => {
				const run = getCurrentRun();
				if (run) {
					const prev = msgCountByRun.get(run.runId) ?? 0;
					const newMsgs = stepOpts.messages.slice(prev);
					if (newMsgs.length > 0) {
						const llmMessages = newMsgs
							.map((msg) => modelMessageToLlmMessage(msg))
							.filter((msg): msg is LLMMessage => msg !== undefined);
						if (llmMessages.length > 0) {
							await run.beforeLlm(llmMessages);
						}
						msgCountByRun.set(run.runId, stepOpts.messages.length);
					}
				}
				if (rest.prepareStep) {
					return rest.prepareStep(stepOpts);
				}
				return undefined;
			},
			onStepFinish: async (step) => {
				const run = getCurrentRun();
				if (
					run &&
					(step.usage.inputTokens !== undefined ||
						step.usage.outputTokens !== undefined)
				) {
					await run.afterLlm({
						content: mapStepContent(step.content),
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

	private async registerTools() {
		if (!this.hasRegisteredTools && this.toolMeta.length > 0) {
			await this.hb.registerTools(this.toolMeta);
			this.hasRegisteredTools = true;
		}
	}

	private async startRun(callOpts: RunCallOpts) {
		return this.hb.startRun({
			runId: uuidv7(),
			model: this.model,
			...this.runDefaults,
			actor: callOpts.actor,
			sessionId: callOpts.sessionId,
			tags: callOpts.tags,
		});
	}

	async generate({
		actor,
		sessionId,
		tags,
		...params
	}: AgentCallParameters<CALL_OPTIONS, TOOLS> & RunCallOpts) {
		await this.registerTools();
		const run = await this.startRun({ actor, sessionId, tags });
		return withRun(run, async () => {
			try {
				const result = await this.inner.generate(params);
				await run.end("success");
				return result;
			} catch (e) {
				await run.end("error");
				throw e;
			}
		});
	}

	async stream({
		actor,
		sessionId,
		tags,
		...params
	}: AgentStreamParameters<CALL_OPTIONS, TOOLS> & RunCallOpts) {
		await this.registerTools();
		const run = await this.startRun({ actor, sessionId, tags });
		return withRun(run, async () => {
			try {
				const result = await this.inner.stream(params);
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

function mapStepContent(
	parts: ContentPart<NoInfer<ToolSet>>[],
): Array<
	| { type: "text"; text: string }
	| { type: "tool_call"; toolCallId: string; toolName: string; args: unknown }
> {
	const result = [];
	for (const part of parts) {
		if (part.type === "text" && part.text) {
			result.push({ type: "text" as const, text: part.text as string });
		} else if (part.type === "tool-call") {
			result.push({
				type: "tool_call" as const,
				toolCallId: part.toolCallId as string,
				toolName: part.toolName as string,
				args: part.input as unknown,
			});
		}
	}
	return result;
}

function resolveModel(model: ToolLoopAgentSettings["model"]): ModelInfo {
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
