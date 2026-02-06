import {
	type Tool as CoreTool,
	type CustomCheck,
	type GovernanceConfig,
	GovernanceEngine,
	generateSlug,
	HANDLEBAR_ACTION_STATUS,
	type HandlebarRunOpts,
	type RunContext,
  tokeniseCount,
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
import { combineMessageStrings, formatModelMessage, formatPrompt, toLLMMessages } from "./messages";

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

type HandlebarAgentOpts<
	TOOLSET extends ToolSet,
	Ctx,
	Memory,
> = ConstructorParameters<typeof Agent<TOOLSET, Ctx, Memory>>[0] & {
	governance?: Omit<GovernanceConfig<ToCoreTool<TOOLSET>>, "tools"> & {
		categories?: Record<string, string[]>; // tool categories by name
	} & HandlebarRunOpts;
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
	public governance: GovernanceEngine<ToCoreTool<ToolSet>>;
	private runCtx: RunContext<ToCoreTool<ToolSet>>;
	private runStarted = false;

	private systemPrompt: string | undefined = undefined;
	private emittedSystemPrompt = false;
	private hasInitialisedEngine = false;
	private agentConfig:
		| {
				slug: string;
				name?: string;
				description?: string;
				tags?: string[];
		  }
		| undefined;

	constructor(opts: HandlebarAgentOpts<ToolSet, Ctx, Memory>) {
		const { tools = {} as ToolSet, governance, agent, ...rest } = opts;

		const toolMeta = (Object.keys(tools) as Array<keyof ToolSet & string>).map(
			(name) => ({
				name,
				categories: governance?.categories?.[name] ?? [],
			}),
		);

		const engine = new GovernanceEngine<ToCoreTool<ToolSet>>({
			tools: toolMeta,
			...governance,
		});

		const runId =
			globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

		const runCtx = engine.createRunContext(runId, {
			enduser: governance?.enduser,
    });

    const modelStringParts = rest.model.toString().split("/");
		const model = { model: modelStringParts[modelStringParts.length - 1] ?? rest.model.toString(), provider: modelStringParts.length > 1 ? modelStringParts[0] : undefined}

		const wrapped = mapTools(tools, (name, t) => {
			if (!t.execute) {
				return t;
			}

			const exec = t.execute.bind(t);

			return {
				...t,
        async execute(args: unknown, options: ToolCallOptions) {
          const lastMessage = options.messages[options.messages.length - 1];
          const lastMessageContent = lastMessage ? formatModelMessage(lastMessage)?.content : undefined;
          const firstMessageContent = combineMessageStrings(options.messages, { includeLast: false });

          if (lastMessageContent && firstMessageContent) {
            engine.emitLLMResult(lastMessageContent, firstMessageContent, toLLMMessages(options.messages), model);
          }


					const decision = await engine.beforeTool(runCtx, String(name), args);

					// Early exit: Rule violations overwrite tool action
					const handlebarResponse = engine.decisionAction(decision);
					if (handlebarResponse) {
						return handlebarResponse;
					}

					try {
						const start = Date.now();
						const res = await exec(args as never, options);
						const end = Date.now();

						await engine.afterTool(
							runCtx,
							String(name),
							end - start,
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

		let stopWhen: StopCondition<NoInfer<ToolSet>>[];

		if (opts.stopWhen === undefined) {
			stopWhen = [];
		} else if (!Array.isArray(opts.stopWhen)) {
			stopWhen = [opts.stopWhen];
		} else {
			stopWhen = opts.stopWhen;
		}

		// Look for HANDLEBAR_RULE_VIOLATION_CODE from response
		// to indicate that there was a exit-worthy rule violation
		stopWhen.push(({ steps }) => {
			const lastStep = steps[steps.length - 1];
			if (lastStep === undefined) {
				return false;
			}

			for (const toolResult of lastStep.toolResults) {
				try {
					const output = JSON.stringify(toolResult.output);
					if (output.includes(HANDLEBAR_ACTION_STATUS.EXIT_RUN_CODE)) {
						return true;
					}
				} catch {}
			}
			return false;
		});

		this.inner = new Agent<ToolSet, Ctx, Memory>({
			...rest,
			stopWhen,
			onStepFinish: async (step) => {
				if (rest.onStepFinish) {
					await rest.onStepFinish(step);
				}

				if (step.text.trim()) {
					this.emitMessage(
						step.text,
						"assistant",
						"output",
						// tags: ["step_output"],
					);
				}

				// TODO: do we need reasoning?
      },
			tools: wrapped,
		});
		this.governance = engine;
		this.runCtx = runCtx;
    this.agentConfig = agent;

		if (rest.system) {
			this.systemPrompt = rest.system;
		}
  }

	private toolInfo() {
		const infoTools: AgentTool[] = [];

		for (const name in this.inner.tools) {
			const tool = this.inner.tools[name];
			if (!tool) {
				continue;
			}

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

	public async initEngine() {
		if (this.hasInitialisedEngine) {
			return;
		}

		await this.governance.initAgentRules(
			this.agentConfig ?? { slug: generateSlug() },
			this.toolInfo(),
		);
		this.hasInitialisedEngine = true;
	}

	private withRun<T>(fn: () => Promise<T> | T): Promise<T> | T {
		return withRunContext(
			{
				runId: this.runCtx.runId,
				stepIndex: this.runCtx.stepIndex,
				enduser: this.runCtx.enduser,
			},
			async () => {
				if (!this.runStarted) {
					this.runStarted = true;

					this.governance.emit("run.started", {
						agent: { framework: "ai-sdk" },
						adapter: { name: "@handlebar/ai-sdk-v5" },
						enduser: this.runCtx.enduser,
					});
					this.maybeEmitSystemPrompt();
				}

				const out = await fn();
				return out;
			},
		);
	}

	private emitMessage(
		message: string,
		role: MessageEvent["data"]["role"],
		kind: MessageEvent["data"]["kind"],
	) {
		let truncated = false;
		let messageFinal = message;

		// TODO: set reasonable limit
		const messageCharLimit = 10000;

		if (message.length > messageCharLimit) {
			truncated = true;
			messageFinal = message.slice(0, messageCharLimit);
		}

		this.governance.emit("message.raw.created", {
			content: messageFinal,
			contentTruncated: truncated,
			role,
			kind,
      messageId: uuidv7(),
      debug: {
        approxTokens: tokeniseCount(messageFinal),
        chars: message.length,
      }
		});
	}

	private maybeEmitSystemPrompt() {
		if (this.emittedSystemPrompt || this.systemPrompt === undefined) {
			return;
		}
		this.emitMessage(this.systemPrompt, "system", "observation");
		this.emittedSystemPrompt = true;
	}

	private emitMessages(prompts: Prompt[]) {
		for (const prompt of prompts) {
			const formattedMessages = formatPrompt(prompt);
			for (const message of formattedMessages) {
				if (message.role === "system") {
					this.systemPrompt = message.content;
					this.maybeEmitSystemPrompt();
				} else {
					this.emitMessage(message.content, message.role, message.kind);
				}
			}
		}
	}

	public with(opts: HandlebarRunOpts) {
		this.runCtx.enduser = opts.enduser;
		return this;
	}

	async generate(
		...params: Parameters<Agent<ToolSet, Ctx, Memory>["generate"]>
	) {
		await this.initEngine();
		return this.withRun(() => {
			this.emitMessages(params);
			return this.inner.generate(...params);
		});
	}

	async stream(...params: Parameters<Agent<ToolSet, Ctx, Memory>["stream"]>) {
		await this.initEngine();
		// TODO: emit streamed messages as audit events.
		return this.withRun(() => {
			this.emitMessages(params);
			return this.inner.stream(...params);
		});
	}

	async respond(...params: Parameters<Agent<ToolSet, Ctx, Memory>["respond"]>) {
		await this.initEngine();
		return this.withRun(() => {
			// this.emitMessages(params); // TODO: fix type error.
			return this.inner.respond(...params);
		});
	}
}
