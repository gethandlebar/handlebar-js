import {
	type Tool as CoreTool,
	type CustomCheck,
	type GovernanceConfig,
	GovernanceEngine,
	type HandlebarRunOpts,
	type RunContext,
	withRunContext,
} from "@handlebar/core";
import {
	Experimental_Agent as Agent,
	type Tool,
	type ToolCallOptions,
	type ToolSet,
} from "ai";

type ToolSetBase = Record<string, Tool<any, any>>;

export type ToCoreTool<T extends ToolSetBase> = {
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
			governance?.userCategory ?? "unknown", // TODO: allow undefined user ID/category
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
			tools: wrapped,
		});
		this.governance = engine;
		this.runCtx = runCtx;
		this.agentConfig = agent;
	}

	public async initEngine() {
		if (this.hasInitialisedEngine) {
			return;
		}

		// TODO: generate consistent placeholder slug.
		await this.governance.initAgentRules(
			this.agentConfig ?? { slug: "temp-placeholder-agent-slug" },
		);
		this.hasInitialisedEngine = true;
	}

	private withRun<T>(opts: HandlebarRunOpts, fn: () => Promise<T> | T): Promise<T> | T {
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
					});
				}

				return await fn();
			},
		);
	}

	async generate(params: Parameters<Agent<ToolSet, Ctx, Memory>["generate"]>, handlebarOpts?: HandlebarRunOpts) {
		await this.initEngine();
    return this.withRun(handlebarOpts ?? {}, () => this.inner.generate(...params));
	}

	async stream(params: Parameters<Agent<ToolSet, Ctx, Memory>["stream"]>, handlebarOpts?: HandlebarRunOpts) {
		await this.initEngine();
		return this.withRun(handlebarOpts ?? {}, () => this.inner.stream(...params));
	}

	async respond(params: Parameters<Agent<ToolSet, Ctx, Memory>["respond"]>, handlebarOpts?: HandlebarRunOpts) {
		await this.initEngine();
		return this.withRun(handlebarOpts ?? {}, () => this.inner.respond(...params));
	}
}
