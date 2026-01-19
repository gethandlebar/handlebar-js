import {
	type Tool as CoreTool,
	type CustomCheck,
	type GovernanceConfig,
	GovernanceEngine,
	type HandlebarRunOpts,
	type RunContext,
	withRunContext,
} from "@handlebar/core";
import type { MessageEventSchema } from "@handlebar/governance-schema";
import {
	Experimental_Agent as Agent,
	type Prompt,
	type Tool,
	type ToolCallOptions,
	type ToolSet,
} from "ai";
import { uuidv7 } from "uuidv7";
import type { z } from "zod";
import { formatPrompt } from "./messages";
import type { AgentTool } from "@handlebar/core/dist/api/types";

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
		userCategory?: string;
		categories?: Record<string, string[]>; // tool categories by name
	};
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

		const runCtx = engine.createRunContext(
			runId,
			governance?.userCategory ?? "unknown", // TODO: remove userCategory.
		);

		const wrapped = mapTools(tools, (name, t) => {
			if (!t.execute) return t;

			const exec = t.execute.bind(t);

			return {
				...t,
				async execute(args: unknown, options: ToolCallOptions) {
					const decision = await engine.beforeTool(runCtx, String(name), args);

					if (engine.shouldBlock(decision)) {
						const err = new Error(
							decision.reason ?? "Blocked by Handlebar governance",
						);
						throw err;
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

		this.inner = new Agent<ToolSet, Ctx, Memory>({
			...rest,
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
      })
    }

    return infoTools;
  }

	public async initEngine() {
		if (this.hasInitialisedEngine) {
			return;
		}

		// TODO: generate consistent placeholder slug.
		await this.governance.initAgentRules(
      this.agentConfig ?? { slug: "temp-placeholder-agent-slug" },
			this.toolInfo(),
		);
		this.hasInitialisedEngine = true;
	}

	private withRun<T>(
		opts: HandlebarRunOpts,
		fn: () => Promise<T> | T,
	): Promise<T> | T {
		return withRunContext(
			{
				runId: this.runCtx.runId,
				userCategory: this.runCtx.userCategory,
				stepIndex: this.runCtx.stepIndex,
				enduser: opts.enduser,
			},
			async () => {
				if (!this.runStarted) {
					this.runStarted = true;

					this.governance.emit("run.started", {
						agent: { framework: "ai-sdk" },
						adapter: { name: "@handlebar/ai-sdk-v5" },
						enduser: opts.enduser,
					});
					this.maybeEmitSystemPrompt();
				}

				return await fn();
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

	// TODO: fix input signature: this requires users to wrap inputs in an array, vs. doing "...params".
	// Maybe extend params directly with handlebarOpts?
	async generate(
		params: Parameters<Agent<ToolSet, Ctx, Memory>["generate"]>,
		handlebarOpts?: HandlebarRunOpts,
	) {
		await this.initEngine();
		return this.withRun(handlebarOpts ?? {}, () => {
			this.emitMessages(params);
			return this.inner.generate(...params);
		});
	}

	async stream(
		params: Parameters<Agent<ToolSet, Ctx, Memory>["stream"]>,
		handlebarOpts?: HandlebarRunOpts,
	) {
		await this.initEngine();
		// TODO: emit streamed messages as audit events.
		return this.withRun(handlebarOpts ?? {}, () => {
			this.emitMessages(params);
			return this.inner.stream(...params);
		});
	}

	async respond(
		params: Parameters<Agent<ToolSet, Ctx, Memory>["respond"]>,
		handlebarOpts?: HandlebarRunOpts,
	) {
		await this.initEngine();
		return this.withRun(handlebarOpts ?? {}, () => {
			// this.emitMessages(params); // TODO: fix type error.
			return this.inner.respond(...params);
		});
	}
}
