import type {
	AppliedAction,
	AuditEvent,
	AuditEventByKind,
	CustomFunctionCondition,
	EndUserConfig,
	EndUserGroupConfig,
	EndUserTagCondition,
	ExecutionTimeCondition,
	GovernanceDecision,
	GovernanceEffect,
	MaxCallsCondition,
	Rule,
	RuleCondition,
	SequenceCondition,
	ToolNameCondition,
	ToolTagCondition,
} from "@handlebar/governance-schema";
import { ApiManager } from "./api/manager";
import { emit } from "./audit";
import type { AuditBus } from "./audit/bus";
import { getRunContext, incStep } from "./audit/context";
import type {
	CustomCheck,
	GovernanceConfig,
	RunContext,
	Tool,
	ToolCall,
	ToolMeta,
	ToolResult,
} from "./types";
import { millisecondsSince } from "./utils";

type GovernanceLog<T extends Tool = Tool> = {
	tool: ToolCall<T>;
	decision: GovernanceDecision;
	when: "before" | "after";
};

const TOTAL_DURATION_COUNTER = "__hb_totalDurationMs";

export class GovernanceEngine<T extends Tool = Tool> {
	private tools: Map<string, ToolMeta<T>>;
	private rules: Rule[];
	private defaultUncategorised: GovernanceEffect;
	private checks: CustomCheck<T>[];
	private mode: "monitor" | "enforce";
	private verbose: boolean;
	private api: ApiManager;

	/**
	 * @deprecated - Superceded by audit log
	 */
	public governanceLog: GovernanceLog<T>[] = [];

	constructor(
		cfg: GovernanceConfig<T>,
		public bus?: AuditBus,
	) {
		this.tools = new Map(cfg.tools.map((t) => [t.name, t]));
		this.rules = cfg.rules ?? [];
		this.defaultUncategorised = cfg.defaultUncategorised ?? "allow";
		this.checks = cfg.checks ?? [];
		this.mode = cfg.mode ?? "enforce";
		this.verbose = Boolean(cfg.verbose);

		this.api = new ApiManager({});
	}

	public async initAgentRules(agentConfig: {
		slug: string;
		name?: string;
		description?: string;
		tags?: string[];
	}): Promise<string | null> {
		const output = await this.api.initialiseAgent(agentConfig);
		if (!output) {
			return null;
		}

		this.rules.push(...(output.rules ?? []));
		return output.agentId;
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
			counters: {
				...(initialCounters ?? {}),
				[TOTAL_DURATION_COUNTER]: 0,
			},
			state: new Map(),
			now,
		};
	}

	public emit<K extends AuditEvent["kind"]>(
		kind: K,
		data: AuditEventByKind[K]["data"],
		extras?: Partial<AuditEvent>,
	): void {
		if (!this.api.agentId) {
			return;
		}

		emit(this.api.agentId, kind, data, extras);
	}

	getTool(name: string) {
		const t = this.tools.get(name);
		if (!t) {
			throw new Error(`Unknown tool "${name}"`);
		}
		return t;
	} /**
	 * With a HITL rule hit, query the API to check for an existing, matching HITL request.
	 *
	 * Querying the API with the triggered API rule will try to match on existing or create a HITL request
	 * if none exists.
	 * If there is an existing, matching request (server should return ID and status), we convert the HITL
	 * action into a new action: on "pending" or "blocked" we convert to "blocked" action client side;
	 * if the HITL request has "approved" then the client side also approves.
	 */
	private async evaluateHitl(
		ruleId: string,
		ctx: RunContext<T>,
		call: ToolCall<T>,
	): Promise<"hitl" | "block" | "allow"> {
		const apiResponse = await this.api.queryHitl(
			ctx.runId,
			ruleId,
			call.tool.name,
			call.args as Record<string, unknown>,
		); // TODO: sort typing of args.
		if (!apiResponse) {
			return "hitl";
		}

		if (apiResponse.pre_existing) {
			if (apiResponse.status === "approved") {
				return "allow";
			}

			return "block";
		}

		// If pre_existing=false, i.e. HITL request generated as part of this rule break,
		// we must return "hitl" for appropriate auditing to propagate.
		return "hitl";
	}

	public async decideByRules(
		phase: "pre" | "post",
		ctx: RunContext<T>,
		call: ToolCall<T>,
		executionTimeMS: number | null,
	): Promise<GovernanceDecision> {
		const applicable = this.rules.filter(
			(r) => r.when === phase || r.when === "both",
		);

		const ordered = [...applicable].sort((a, b) => a.priority - b.priority);

		let decision:
			| Pick<GovernanceDecision, "effect" | "code" | "reason">
			| undefined;

		const appliedRules: AppliedAction[] = [];
		const matchingRules: string[] = [];

		for (const rule of ordered) {
			const matches = await this.evalCondition(rule.condition, {
				phase,
				ctx,
				call,
				executionTimeMS,
			});

			if (!matches) {
				continue;
			}
			matchingRules.push(rule.id);

			if (!rule.actions.length) {
				continue;
			}

			for (const action of rule.actions) {
				appliedRules.push({
					ruleId: rule.id,
					type: action.type,
				});

				let actionType = action.type;
				if (actionType === "hitl") {
					// Trigger or match a HITL request
					actionType = await this.evaluateHitl(rule.id, ctx, call);
				}

				if (actionType === "block") {
					return {
						effect: "block",
						code: "BLOCKED_RULE",
						appliedActions: appliedRules,
						matchedRuleIds: appliedRules.map((ar) => ar.ruleId),
					};
				} else if (actionType === "hitl") {
					return {
						effect: "hitl",
						code: "BLOCKED_HITL_REQUESTED",
						appliedActions: appliedRules,
						matchedRuleIds: appliedRules.map((ar) => ar.ruleId),
					};
				} else if (actionType === "allow" && decision?.effect !== "block") {
					decision = {
						effect: "allow",
						code: "ALLOWED",
					};
					// keep scanning; a later higher-priority rule might block
				}
			}
		}

		const finalDecision: GovernanceDecision = {
			matchedRuleIds: matchingRules,
			appliedActions: appliedRules,
			...(decision ?? { effect: "allow", code: "ALLOWED" }),
		};

		return finalDecision;
	}

	private async evalCondition(
		cond: RuleCondition,
		args: {
			phase: "pre" | "post";
			ctx: RunContext<T>;
			call: ToolCall<T>;
			executionTimeMS: number | null;
		},
	): Promise<boolean> {
		const conditionKind = cond.kind;
		switch (cond.kind) {
			case "toolName":
				return this.evalToolName(cond, args.call.tool.name);

			case "toolTag":
				return this.evalToolTag(cond, args.call.tool.categories ?? []);

			case "enduserTag":
				// TODO: we need enduser info in context and to pass it in here.
				return this.evalEnduserTag(cond, args.ctx.enduser);

			case "executionTime":
				// only meaningful post-tool
				if (args.phase !== "post") return false;
				return this.evalExecutionTime(cond, args.executionTimeMS, args.ctx);

			case "sequence":
				return this.evalSequence(cond, args.ctx.history, args.call.tool.name);

			case "maxCalls":
				return this.evalMaxCalls(cond, args.ctx.history);

			case "custom":
				return this.evalCustom(cond, args.ctx, args.call);

			case "and":
				if (!cond.all.length) return true;
				for (const child of cond.all) {
					if (!(await this.evalCondition(child, args))) return false;
				}
				return true;

			case "or":
				if (!cond.any.length) return false;
				for (const child of cond.any) {
					if (await this.evalCondition(child, args)) return true;
				}
				return false;

			case "not":
				return !(await this.evalCondition(cond.not, args));

			default:
				console.warn(`[Handlebar] Unknown condition kind: ${conditionKind}`);
				return true;
		}
	}

	private evalToolName(cond: ToolNameCondition, toolName: string): boolean {
		const name = toolName.toLowerCase();

		const matchGlob = (value: string, pattern: string): boolean => {
			const esc = pattern
				.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
				.replace(/\*/g, ".*");
			const re = new RegExp(`^${esc}$`, "i");
			return re.test(value);
		};

		switch (cond.op) {
			case "eq":
				return name === cond.value.toString().toLowerCase();
			case "neq":
				return name !== cond.value.toString().toLowerCase();
			case "contains":
				return name.includes(cond.value.toString().toLowerCase());
			case "startsWith":
				return name.startsWith(cond.value.toString().toLowerCase());
			case "endsWith":
				return name.endsWith(cond.value.toString().toLowerCase());
			case "glob":
				return matchGlob(name, cond.value as string);
			case "in":
				return cond.value.some((v) => matchGlob(name, v as string));
		}
	}

	/**
	 * Evaluate rules on metadata attached to enduser.
	 * Enduser may not be defined at runtime, in which case the rule evaluates negatively.
	 *
	 * Rules on the metadata tags attached to the enduser CURRENTLY evaluate only on metadata
	 * provided at runtime (which is passed through in run context).
	 * @todo - Fetch resolved user metadata from server and pass that through in run context. N.b. this function shouldn't change.
	 */
	private evalEnduserTag(
		cond: EndUserTagCondition,
		enduser: (EndUserConfig & { group?: EndUserGroupConfig }) | undefined,
	): boolean {
		if (enduser == undefined) {
			return false;
		}

		if (cond.op === "has") {
			const tagValue = enduser.metadata[cond.tag];
			if (!tagValue) {
				return false;
			}

			try {
				const booleanTagValue = Boolean(tagValue);
				return booleanTagValue;
			} catch (error) {
				console.error(
					`[Handlebar] Error evaluating enduser tag ${cond.tag}: ${error}`,
				);
				return false;
			}
		}

		if (cond.op === "hasValue") {
			const tagValue = enduser.metadata[cond.tag];
			if (!tagValue) {
				return false;
			}

			return tagValue === cond.value;
		}

		return false;
	}

	private evalToolTag(cond: ToolTagCondition, tags: string[]): boolean {
		const lower = tags.map((t) => t.toLowerCase());

		switch (cond.op) {
			case "has":
				return lower.includes(cond.tag.toLowerCase());
			case "anyOf":
				return cond.tags.some((t) => lower.includes(t.toLowerCase()));
			case "allOf":
				return cond.tags.every((t) => lower.includes(t.toLowerCase()));
		}
	}

	private evalExecutionTime(
		cond: ExecutionTimeCondition,
		executionTimeMS: number | null,
		ctx: RunContext<T>,
	): boolean {
		if (executionTimeMS === null) return false;

		const totalMs = ctx.counters[TOTAL_DURATION_COUNTER] ?? 0;

		const valueMs = cond.scope === "tool" ? executionTimeMS : totalMs; // v0: "total" = accumulated in counters

		switch (cond.op) {
			case "gt":
				return valueMs > cond.ms;
			case "gte":
				return valueMs >= cond.ms;
			case "lt":
				return valueMs < cond.ms;
			case "lte":
				return valueMs <= cond.ms;
			case "eq":
				return valueMs === cond.ms;
			case "neq":
				return valueMs !== cond.ms;
		}
	}

	private evalSequence(
		cond: SequenceCondition,
		history: ToolResult<T>[],
		currentToolName: string,
	): boolean {
		const names = history.map((h) => h.tool.name);

		const matchGlob = (value: string, pattern: string): boolean => {
			const esc = pattern
				.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
				.replace(/\*/g, ".*");
			const re = new RegExp(`^${esc}$`, "i");
			return re.test(value);
		};

		if (cond.mustHaveCalled?.length) {
			for (const pattern of cond.mustHaveCalled) {
				const found = names.some((n) => matchGlob(n, pattern));
				if (!found) {
					return true;
				}
			}
		}

		if (cond.mustNotHaveCalled?.length) {
			for (const pattern of cond.mustNotHaveCalled) {
				const found = names.some((n) => matchGlob(n, pattern));
				if (found) {
					return true;
				}
			}
		}

		return false;
	}

	private evalMaxCalls(
		cond: MaxCallsCondition,
		history: ToolResult<T>[],
	): boolean {
		const matchGlob = (value: string, pattern: string): boolean => {
			const esc = pattern
				.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
				.replace(/\*/g, ".*");
			const re = new RegExp(`^${esc}$`, "i");
			return re.test(value);
		};

		let count = 0;

		if (cond.selector.by === "toolName") {
			for (const h of history) {
				if (cond.selector.patterns.some((p) => matchGlob(h.tool.name, p))) {
					count++;
				}
			}
		} else {
			for (const h of history) {
				const tags = (h.tool.categories ?? []).map((t) => t.toLowerCase());
				if (
					cond.selector.tags.some((tag) => tags.includes(tag.toLowerCase()))
				) {
					count++;
				}
			}
		}

		return count >= cond.max;
	}

	private async evalCustom(
		cond: CustomFunctionCondition,
		ctx: RunContext<T>,
		call: ToolCall<T>,
	): Promise<boolean> {
		// For now, no central registry; user can still use CustomCheck.before
		return false;
	}

	async beforeTool(
		ctx: RunContext<T>,
		toolName: string,
		args: unknown,
	): Promise<GovernanceDecision> {
		const runCtx = getRunContext();
		const localStep = runCtx?.stepIndex ?? 0;
		const t0 = performance.now();

		const tool = this.getTool(toolName);
		const call: ToolCall<T> = { tool, args } as ToolCall<T>;

		// TODO: Need to rework these.
		for (const check of this.checks) {
			if (check.before) {
				const d = await check.before(ctx, call);
				if (d && d.effect === "block") {
					this.emit(
						"tool.decision",
						{
							tool: {
								name: toolName,
								categories: tool.categories,
							},
							effect: d.effect,
							code: d.code,
							reason: d.reason,
							matchedRuleIds: d.matchedRuleIds,
							appliedActions: d.appliedActions,
							counters: { ...ctx.counters },
							latencyMs: millisecondsSince(t0),
						},
						{ stepIndex: localStep },
					);

					return this._finaliseDecision(ctx, call, {
						...d,
						code: d.code ?? "BLOCKED_CUSTOM",
					});
				}
			}
		}

		const decision = await this.decideByRules("pre", ctx, call, null);
		const finalDecision = this._finaliseDecision(ctx, call, decision);

		console.debug(`[Handlebar] ${toolName} ${decision.code}`);
		this.emit(
			"tool.decision",
			{
				tool: { name: toolName, categories: tool.categories },
				effect: decision.effect,
				code: decision.code,
				reason: decision.reason,
				matchedRuleIds: decision.matchedRuleIds,
				appliedActions: decision.appliedActions,
				counters: { ...ctx.counters },
				latencyMs: millisecondsSince(t0),
			},
			{ stepIndex: localStep },
		);

		return finalDecision;
	}

	private _finaliseDecision(
		ctx: RunContext<T>,
		call: ToolCall<T>,
		decision: GovernanceDecision,
	): GovernanceDecision {
		if (this.verbose) {
			const tag = decision.effect === "allow" ? "✅" : "⛔";
			const ruleId =
				decision.appliedActions[decision.appliedActions.length - 1]?.ruleId;
			console.debug(
				`[Handlebar] ${tag} run=${ctx.runId} step=${ctx.stepIndex} tool=${call.tool.name} decision=${decision.code}${ruleId ? ` rule=${ruleId}` : ""}${decision.reason ? ` reason="${decision.reason}"` : ""}`,
			);
		}

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
		const runCtx = getRunContext();
		const localStep = runCtx?.stepIndex ?? 0;
		const decisionId = runCtx?.decisionId;
		const tool = this.getTool(toolName);

		const tr: ToolResult<T> = {
			tool,
			args,
			result,
			error,
		} as ToolResult<T>;

		ctx.history.push(tr);
		ctx.stepIndex += 1;

		if (executionTimeMS !== null) {
			ctx.counters[TOTAL_DURATION_COUNTER] =
				(ctx.counters[TOTAL_DURATION_COUNTER] ?? 0) + executionTimeMS;
		}

		for (const check of this.checks) {
			if (check.after) {
				await check.after(ctx, tr);
			}
		}

		const postDecision = await this.decideByRules(
			"post",
			ctx,
			{ tool, args } as ToolCall<T>,
			executionTimeMS,
		);

		if (postDecision.effect === "block" && this.verbose) {
			console.warn(
				`[Handlebar] ⛔ post-tool rule would block "${toolName}" (not enforced yet).`,
			);
		}

		const errorAsError = error instanceof Error ? error : null;
		this.emit(
			"tool.result",
			{
				tool: { name: toolName, categories: tool.categories },
				outcome: error ? "error" : "success",
				durationMs: executionTimeMS ?? undefined,
				counters: { ...ctx.counters },
				error: errorAsError
					? { name: errorAsError.name, message: errorAsError.message }
					: undefined,
			},
			{ stepIndex: localStep, decisionId },
		);

		incStep();
	}

	shouldBlock(decision: GovernanceDecision) {
		return this.mode === "enforce" && decision.effect === "block";
	}
}
