import type { AuditBus } from "./audit/bus";
import type {
	AuditSink,
	CustomCheck,
	Decision,
	DecisionEffect,
	GovernanceConfig,
	Rule,
	RunContext,
	SequencePolicy,
	Tool,
	ToolCall,
	ToolMeta,
	ToolResult,
} from "./types";

function evaluateSequencePolicy<T extends Tool>(
	policy: NonNullable<GovernanceConfig<T>["sequence"]>,
	ctx: RunContext<T>,
	call: ToolCall<T>,
): Decision | undefined {
	if (policy.mustOccurBefore) {
		for (const r of policy.mustOccurBefore) {
			if (call.tool.name === r.after) {
				const hasBefore = ctx.history.some((h) => h.tool.name === r.before);
				if (!hasBefore) {
					return {
						effect: "block",
						code: "BLOCKED_SEQUENCE",
						reason: `Requires "${r.before}" before "${r.after}"`,
					};
				}
			}
		}
	}

	if (policy.maxCalls) {
		const max = policy.maxCalls[call.tool.name];
		if (typeof max === "number") {
			const used = ctx.history.filter(
				(h) => h.tool.name === call.tool.name,
			).length;

			if (used >= max) {
				return {
					effect: "block",
					code: "BLOCKED_LIMIT",
					reason: `Max calls for "${call.tool.name}" is ${max}`,
				};
			}
		}
	}

	if (policy.disallowConsecutive?.includes(call.tool.name)) {
		const last = ctx.history[ctx.history.length - 1];

		if (last?.tool.name === call.tool.name) {
			return {
				effect: "block",
				code: "BLOCKED_SEQUENCE",
				reason: `No consecutive "${call.tool.name}" calls`,
			};
		}
	}

	return undefined;
}

type GovernanceLog<T extends Tool = Tool> = {
	tool: ToolCall<T>;
	decision: Decision;
	when: "before" | "after";
};

export class GovernanceEngine<T extends Tool = Tool> {
	private tools: Map<string, ToolMeta<T>>;
	private rules: Rule[];
	private defaultUncategorised: DecisionEffect;
	private sequence?: SequencePolicy;
	private checks: CustomCheck<T>[];
	private audit?: AuditSink<T>;
	private mode: "monitor" | "enforce";
	private verbose: boolean;

	public governanceLog: GovernanceLog<T>[] = [];

	constructor(cfg: GovernanceConfig<T>, audit?: AuditSink<T>, public bus?: AuditBus) {
		this.tools = new Map(cfg.tools.map((t) => [t.name, t]));
		this.rules = cfg.rules ?? [];
		this.defaultUncategorised = cfg.defaultUncategorised ?? "allow";
		this.sequence = cfg.sequence;
		this.checks = cfg.checks ?? [];
		this.audit = audit;
		this.mode = cfg.mode ?? "enforce";
		this.verbose = Boolean(cfg.verbose);
	}

	createRunContext(
		runId: string,
		userCategory: string,
		now = () => Date.now(),
		initialCounters?: Record<string, number>,
	): RunContext<T> {
		return {
			runId,
			userCategory,
			stepIndex: 0,
			history: [],
			counters: { ...(initialCounters ?? {}) },
			state: new Map(),
			now,
		};
	}

	getTool(name: string) {
		const t = this.tools.get(name);
		if (!t) {
			throw new Error(`Unknown tool "${name}"`);
		}

		return t;
	}

	private async decideByRules(
		ctx: RunContext<T>,
		call: ToolCall<T>,
	): Promise<Decision> {
		if (
			(!call.tool.categories || call.tool.categories.length === 0) &&
			this.defaultUncategorised === "block"
		) {
			return {
				effect: "block",
				code: "BLOCKED_UNCATEGORISED",
				reason: `Tool "${call.tool.name}" has no categories`,
			};
		}

		// TODO: allow for superceding rules. e.g. "any" mode vs. "all" mode.
		for (const rule of this.rules) {
			if (await rule.when.evaluate(ctx, call)) {
				const d: Decision = {
					effect: rule.effect,
					code: rule.effect === "allow" ? "ALLOWED" : "BLOCKED_RULE",
					reason: rule.reason,
					ruleId: rule.id,
				};
				return d;
			}
		}

		return { effect: "allow", code: "ALLOWED" };
	}

	async beforeTool(
		ctx: RunContext<T>,
		toolName: string,
		args: unknown,
	): Promise<Decision> {
		const tool = this.getTool(toolName);
		const call: ToolCall<T> = { tool, args } as ToolCall<T>;

		let decision: Decision | undefined;

		if (this.sequence) {
			decision = evaluateSequencePolicy(this.sequence, ctx, call);
			if (decision) {
				return this._finaliseDecision(ctx, call, decision);
			}
		}

		for (const check of this.checks) {
			if (check.before) {
				const d = await check.before(ctx, call);
				if (d && d.effect === "block") {
					return this._finaliseDecision(ctx, call, {
						...d,
						code: d.code ?? "BLOCKED_CUSTOM",
					});
				}
			}
		}

		decision = await this.decideByRules(ctx, call);
		return this._finaliseDecision(ctx, call, decision);
	}

	private _finaliseDecision(
		ctx: RunContext<T>,
		call: ToolCall<T>,
		decision: Decision,
	): Decision {
		if (this.verbose) {
			const tag = decision.effect === "allow" ? "✅" : "⛔";
			console.log(
				`[handlebar] ${tag} run=${ctx.runId} step=${ctx.stepIndex} tool=${call.tool.name} decision=${decision.code}${decision.ruleId ? ` rule=${decision.ruleId}` : ""}${decision.reason ? ` reason="${decision.reason}"` : ""}`,
			);
		}
		this.audit?.onDecision?.(ctx, call, decision);
		// TODO: generalise this log update.
		this.governanceLog.push({ tool: call, decision, when: "before" });
		return decision;
	}

	async afterTool(
		ctx: RunContext<T>,
		toolName: string,
		executionTimeMS: number | null,
		args: unknown,
		result: unknown,
		error?: unknown,
	) {
		const tool = this.getTool(toolName);

		const tr: ToolResult<T> = {
			tool,
			args,
			result,
			error,
		} as ToolResult<T>;
		ctx.history.push(tr);
		ctx.stepIndex += 1;

		for (const check of this.checks) {
			if (check.after) {
				await check.after(ctx, tr);
			}
		}

		// TODO: do something with breach
		this.executionTimeBreach(executionTimeMS, tool.name);

		this.audit?.onResult?.(ctx, tr);

		// TODO: need to block if post-tool decision.
	}

	executionTimeBreach(
		executionTimeMS: number | null,
		toolName: string,
	): boolean {
		if (executionTimeMS === null) {
			return false;
		}

		const limits = this.sequence?.executionLimitsMS;
		if (!limits) {
			return false;
		}

		if (!limits[toolName]) {
			return false;
		}

		return executionTimeMS > limits[toolName];
	}

	shouldBlock(decision: Decision) {
		return this.mode === "enforce" && decision.effect === "block";
	}
}
