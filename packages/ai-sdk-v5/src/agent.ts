import {
	type Tool as CoreTool,
	type CustomCheck,
	emit,
	type GovernanceConfig,
	GovernanceEngine,
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
		categories?: Record<string, string[]>; // tool categories.
	};
};

export class HandlebarAgent<
	const ToolSet extends ToolSetBase,
	Ctx = unknown,
	Memory = unknown,
> {
	private inner: Agent<ToolSet, Ctx, Memory>;
	public governance: GovernanceEngine<ToCoreTool<ToolSet>>;

	constructor(opts: HandlebarAgentOpts<ToolSet, Ctx, Memory>) {
		const { tools = {} as ToolSet, governance, ...rest } = opts;

		const toolMeta = (Object.keys(tools) as Array<keyof ToolSet & string>).map(
			(name) => ({
				name,
				categories: governance?.categories?.[name] ?? [],
			}),
		);

		const engine = new GovernanceEngine<ToCoreTool<ToolSet>>(
			{ tools: toolMeta, ...governance },
			{
				onDecision: (_ctx, _call, _d) => {
					if (governance?.verbose) {
						// TODO: what to do with onDecision here??
					}
				},
			},
		);

		const runId =
			globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
		const runCtx = engine.createRunContext(
			runId,
			governance?.userCategory ?? "unknown", // TODO: allow undefined / empty array
		);

		withRunContext(
			{
				runId: runCtx.runId,
				userCategory: runCtx.userCategory,
				stepIndex: runCtx.stepIndex,
			},
			() => {
				// TODO: get types on emit data.
				emit("run.started", {
					agent: { framework: "ai-sdk" },
					adapter: { name: "@handlebar/ai-sdk-v5" },
				});
				// TODO: proceed with agent loop; beforeTool/afterTool to run under ALS
			},
		);

		const wrapped = mapTools(tools, (name, t) => {
			if (!t.execute) {
				return t;
			}

			const exec = t.execute.bind(t);

			return {
				...t,
				async execute(args: unknown, options: ToolCallOptions) {
					const decision = await engine.beforeTool(runCtx, String(name), args);
					if (engine.shouldBlock(decision)) {
						const err = new Error(decision.reason ?? "Blocked by Handlebar");
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
	}

	generate(...a: Parameters<Agent<ToolSet, Ctx, Memory>["generate"]>) {
		return this.inner.generate(...a);
	}
	stream(...a: Parameters<Agent<ToolSet, Ctx, Memory>["stream"]>) {
		return this.inner.stream(...a);
	}
	respond(...a: Parameters<Agent<ToolSet, Ctx, Memory>["respond"]>) {
		return this.inner.respond(...a);
	}
}
function withRunContext(
	arg0: { runId: any; userCategory: any; stepIndex: any },
	arg1: () => void,
) {
	throw new Error("Function not implemented.");
}
