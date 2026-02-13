import type {
	AppliedAction,
	AuditEvent,
	AuditEventByKind,
	EndUserConfig,
	EndUserGroupConfig,
	EndUserTagCondition,
	ExecutionTimeCondition,
	GovernanceDecision,
	MaxCallsCondition,
	RequireSubjectCondition,
	Rule,
	RuleCondition,
	RuleEffectKind,
	RulePhase,
	RuleSelector,
	SequenceCondition,
	TimeGateCondition,
	ToolNameCondition,
	ToolTagCondition,
} from "@handlebar/governance-schema";
import type { ToolArgCondition } from "@handlebar/governance-schema/dist/rules/tools";
import { decisionCodeFor, effectRank } from "./actions";
import { ApiManager } from "./api/manager";
import type { AgentTool } from "./api/types";
import { emit } from "./audit";
import type { AuditBus } from "./audit/bus";
import { getRunContext, incStep } from "./audit/context";
import { BudgetManager } from "./budget-manager";
import {
	AgentMetricCollector,
	type AgentMetricHook,
	type AgentMetricHookPhase,
	AgentMetricHookRegistry,
	approxBytes,
	approxRecords,
} from "./metrics";
import type { MetricInfo } from "./metrics/types";
import {
	compareSignal,
	resultToSignalSchema,
	type SignalProvider,
	SignalRegistry,
	type SignalResult,
	sanitiseSignals,
} from "./signals";
import { type SubjectRef, SubjectRegistry, sanitiseSubjects } from "./subjects";
import { hhmmToMinutes, nowToTimeParts } from "./time";
import { type LLMMessage, tokeniseByKind, tokeniseCount } from "./tokens";
import { toolResultMetadata } from "./tool";
import type {
	CustomCheck,
	GovernanceConfig,
	RunContext,
	Tool,
	ToolCall,
	ToolMeta,
	ToolResult,
} from "./types";
import { getByDotPath, millisecondsSince } from "./utils";

type EvalArgs<T extends Tool = Tool> = {
	phase: RulePhase;
	ctx: RunContext<T>;
	call: ToolCall<T>;
	executionTimeMS: number | null;
	subjects: SubjectRef[];
	// per-call caches
	signalCache: Map<string, SignalResult>;
};

export const HANDLEBAR_ACTION_STATUS = {
	EXIT_RUN_CODE: "HANDLEBAR_EXIT_RUN",
	TOOL_BLOCK_CODE: "HANDLEBAR_TOOL_BLOCK",
};

const TOTAL_DURATION_COUNTER = "__hb_totalDurationMs";

export class GovernanceEngine<T extends Tool = Tool> {
  private agentId: string | null;
	private tools: Map<string, ToolMeta<T>>;
	private rules: Rule[];
	private checks: CustomCheck<T>[];
	private mode: "monitor" | "enforce";
	private verbose: boolean;

  private api: ApiManager;
  private budgetManager: BudgetManager;

	// per-tool-call collector (do not keep globally)
	private metrics: AgentMetricCollector | null;
	private metricHooks: AgentMetricHookRegistry;

	// registries
	private subjects = new SubjectRegistry<T>();
	private signals = new SignalRegistry();

	constructor(
		cfg: GovernanceConfig<T>,
		public bus?: AuditBus,
  ) {
    this.agentId = null;
		this.tools = new Map(cfg.tools.map((t) => [t.name, t]));
		this.rules = cfg.rules ?? [];
		this.checks = cfg.checks ?? [];
		this.mode = cfg.mode ?? "enforce";
		this.verbose = Boolean(cfg.verbose);

    this.api = new ApiManager({});
		this.budgetManager = new BudgetManager();
		this.metrics = null;
		this.metricHooks = new AgentMetricHookRegistry();
	}

	public async initAgentRules(
		agentConfig: {
			slug: string;
			name?: string;
			description?: string;
			tags?: string[];
		},
		tools: AgentTool[],
	): Promise<string | null> {
		const output = await this.api.initialiseAgent(agentConfig, tools);
		if (!output) {
			return null;
		}

    this.rules.push(...((output.rules ?? []) as Rule[]));

    if (output.budget) {
      this.budgetManager.updateBudgets(output.budget.expires_seconds, output.budget.responses)
    }

    this.agentId = output.agentId;
		return output.agentId;
	}

	public registerMetric<P extends AgentMetricHookPhase>(
		hook: AgentMetricHook<P>,
	) {
		this.metricHooks.registerHook(hook);
	}

	public registerSubjectExtractor(
		toolName: string,
		extractor: Parameters<SubjectRegistry<T>["register"]>[1],
	) {
		this.subjects.register(toolName, extractor);
	}

	public registerSignal(key: string, provider: SignalProvider) {
		this.signals.register(key, provider);
	}

	createRunContext(
		runId: string,
		opts?: {
			initialCounters?: Record<string, number>;
			enduser?: EndUserConfig & { group?: EndUserGroupConfig };
			model?: {
				name: string;
				provider?: string;
			};
		},
		now = () => Date.now(),
	): RunContext<T> {
		return {
			runId,
			stepIndex: 0,
			history: [],
			counters: {
				...(opts?.initialCounters ?? {}),
				[TOTAL_DURATION_COUNTER]: 0,
			},
			state: new Map(),
			now,
			model: opts?.model,
			enduser: opts?.enduser,
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

	/**
	 * Provide direct results of an llm call to be emitted as an event.
	 *
	 * Approximates in/out tokens using BPE, and source attribution if provded.
	 * Tokenisation is using an implementation of OpenAI's `tiktoken` library, so the values may not be exact for other providers.
	 */
	public emitLLMResult(
		inputs: {
			outText?: string;
			inText?: string;
			outTokens?: number;
			inTokens?: number;
		},
		messages: LLMMessage[],
		model: { name: string; provider?: string },
		meta?: { durationMs?: number },
	) {
		let outTokens: number;
		let inTokens: number;

		if (inputs.outTokens) {
			outTokens = inputs.outTokens;
		} else if (inputs.outText) {
			outTokens = tokeniseCount(inputs.outText);
		} else {
			throw new Error("Invalid input: output tokens or text must be provided");
		}

		if (inputs.inTokens) {
			inTokens = inputs.inTokens;
		} else if (inputs.inText) {
			inTokens = tokeniseCount(inputs.inText);
		} else {
			throw new Error("Invalid input: input tokens or text must be provided");
		}

		this.emit("llm.result", {
			messageCount: messages.length ?? 0, // TODO: decide if this should be optional
			tokens: {
				in: inTokens,
				out: outTokens,
			},
			model,
			debug: {
				inTokenAttribution: tokeniseByKind(messages),
			},
			durationMs: meta?.durationMs,
		});
	}

	getTool(name: string) {
		const t = this.tools.get(name);
		if (!t) throw new Error(`Unknown tool "${name}"`);
		return t;
	}

	private ruleSelectorMatches(
		ruleSel: RuleSelector,
		phase: RulePhase,
		call: ToolCall<T>,
	): boolean {
		if (ruleSel.phase !== phase) {
			return false;
		}

		const toolSel = ruleSel.tool;
		if (!toolSel) {
			return true;
		}

		const toolName = call.tool.name;
		const toolTags = call.tool.categories ?? [];

		const matchGlob = (value: string, pattern: string): boolean => {
			const esc = pattern
				.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
				.replace(/\*/g, ".*");
			return new RegExp(`^${esc}$`, "i").test(value);
		};

		if (toolSel.name) {
			const patterns = Array.isArray(toolSel.name)
				? toolSel.name
				: [toolSel.name];
			const ok = patterns.some((p) => matchGlob(toolName, p));
			if (!ok) return false;
		}

		if (toolSel.tagsAll?.length) {
			const lower = toolTags.map((t) => t.toLowerCase());
			if (!toolSel.tagsAll.every((t) => lower.includes(t.toLowerCase())))
				return false;
		}

		if (toolSel.tagsAny?.length) {
			const lower = toolTags.map((t) => t.toLowerCase());
			if (!toolSel.tagsAny.some((t) => lower.includes(t.toLowerCase())))
				return false;
		}

		return true;
	}

	private evalRequireSubject(
		cond: RequireSubjectCondition,
		subjects: SubjectRef[],
	): boolean {
		const matches = subjects.filter((s) => s.subjectType === cond.subjectType);
		if (!matches.length) {
			return false;
		}

		if (cond.idSystem) {
			return matches.some((s) => s.idSystem === cond.idSystem);
		}

		return true;
	}

	private evalTimeGate(cond: TimeGateCondition, ctx: RunContext<T>): boolean {
		// timezone from enduserTag
		const enduser = ctx.enduser;
		const tzTag =
			cond.timezone?.source === "enduserTag" ? cond.timezone.tag : undefined;
		const tz = tzTag ? enduser?.metadata?.[tzTag] : undefined;

		// fallback "org" not implemented. If missing => fail closed.
		if (typeof tz !== "string" || tz.length === 0) {
			return false;
		}

    if (typeof tz !== "string" || !tz.length) { return false; }

		const { dow, hhmm } = nowToTimeParts(ctx.now(), tz);
		const nowMin = hhmmToMinutes(hhmm);

		for (const w of cond.windows) {
      if (!w.days.includes(dow as any)) { continue; }
			const startMin = hhmmToMinutes(w.start);
			const endMin = hhmmToMinutes(w.end);
      if (startMin <= nowMin && nowMin <= endMin) { return true; }
		}
		return false;
	}

  private async evalCondition(
    ruleId: string,
		cond: RuleCondition,
		args: EvalArgs<T>,
	): Promise<boolean> {
		switch (cond.kind) {
			case "toolName":
				return this.evalToolName(
					cond as ToolNameCondition,
					args.call.tool.name,
				);

			case "toolTag":
				return this.evalToolTag(cond, args.call.tool.categories ?? []);

			case "toolArg":
				return this.evalToolArg(cond, args.call.args);

			case "enduserTag":
				return this.evalEnduserTag(cond, args.ctx.enduser);

			case "executionTime":
				if (args.phase !== "tool.after") {
					return false;
				}
				return this.evalExecutionTime(cond, args.executionTimeMS, args.ctx);

			case "sequence":
				return this.evalSequence(cond, args.ctx.history, args.call.tool.name);

			case "maxCalls":
				return this.evalMaxCalls(cond, args.ctx.history);

			case "timeGate":
				return this.evalTimeGate(cond, args.ctx);

			case "requireSubject":
				return this.evalRequireSubject(cond, args.subjects);

			case "signal": {
				const res = await this.signals.eval(
					cond.key,
					cond.args,
					{ ctx: args.ctx, call: args.call, subjects: args.subjects },
					args.signalCache,
				);

				if (!res.ok) {
					// missing provider / error: treat as "not matched" locally.
					return false;
				}

				return compareSignal(cond.op, res.value, cond.value);
			}

      case "metricWindow":
        return await this.evalMetricWindow(ruleId);

			case "custom":
				// Prefer signals over custom functions in V2; treat as not supported in core.
				return false;

			case "and": {
				if (!cond.all.length) {
					return true;
				}
				for (const child of cond.all) {
					if (!(await this.evalCondition(ruleId, child, args))) {
						return false;
					}
				}
				return true;
			}

			case "or": {
				if (!cond.any.length) {
					return false;
				}
				for (const child of cond.any) {
					if (await this.evalCondition(ruleId, child, args)) {
						return true;
					}
				}
				return false;
			}

			case "not":
				return !(await this.evalCondition(ruleId, cond.not, args));
		}
  }

  private async evalMetricWindow(ruleId: string): Promise<boolean> {
    const shouldEvaluate = this.budgetManager.reevaluate();
    if (this.agentId &&shouldEvaluate) {
      const budgets = await this.api.evaluateMetrics(this.agentId, this.rules);
      if (budgets === null) {
        return false;
      }
      this.budgetManager.updateBudgets(budgets.expires_seconds, budgets.responses);
    }

    for (const budget of this.budgetManager.budgets) {
      if (budget.id === ruleId && budget.decision === "block") {
        // Budget has been exhausted: "block".
        // Actual enforcement is left to the rule effect, which happens outside this function.
        return true;
      }
    }

    return false;
  }

	private evalToolName(cond: ToolNameCondition, toolName: string): boolean {
		const name = toolName.toLowerCase();
		const matchGlob = (value: string, pattern: string): boolean => {
			const esc = pattern
				.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
				.replace(/\*/g, ".*");
			return new RegExp(`^${esc}$`, "i").test(value);
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

	private evalToolArg(cond: ToolArgCondition, args: unknown): boolean {
		const arg = getByDotPath(args, cond.path);

		if (arg === undefined) {
			console.debug(
				`[Handlebar] argument ${cond.path} not found in tool arg condition; evaluating 'false'`,
			);
			return false;
		}

		switch (cond.type) {
			case "string": {
				const isString = typeof arg === "string";
				if (!isString) {
					console.debug(
						`[Handlebar] argument ${cond.path} is not a string; evaluating 'false'`,
					);
					return false;
				}
				switch (cond.op) {
					case "contains":
						return arg.includes(cond.value as string);
					case "startsWith":
						return arg.startsWith(cond.value as string);
					case "endsWith":
						return arg.endsWith(cond.value as string);
					case "eq":
						return arg === cond.value;
					case "neq":
						return arg !== cond.value;
					case "in":
						return cond.value.includes(arg);
					default:
						console.debug(
							`[Handlebar] unknown operator ${JSON.stringify(cond)} for string condition; evaluating 'false'`,
						);
						return false;
				}
			}
			case "number": {
				const isNumber = typeof arg === "number";
				if (!isNumber) {
					console.debug(
						`[Handlebar] argument ${cond.path} is not a number; evaluating 'false'`,
					);
					return false;
				}

				switch (cond.op) {
					case "eq":
						return arg === cond.value;
					case "neq":
						return arg !== cond.value;
					case "lt":
						return arg < cond.value;
					case "lte":
						return arg <= cond.value;
					case "gt":
						return arg > cond.value;
					case "gte":
						return arg >= cond.value;
					default:
						console.debug(
							`[Handlebar] unknown operator ${JSON.stringify(cond)} for number condition; evaluating 'false'`,
						);
						return false;
				}
			}
			case "boolean": {
				const isBoolean = typeof arg === "boolean";
				if (!isBoolean) {
					console.debug(
						`[Handlebar] argument ${cond.path} is not a boolean; evaluating 'false'`,
					);
					return false;
				}

				return cond.value === arg;
			}
		}
	}

	private evalEnduserTag(
		cond: EndUserTagCondition,
		enduser: (EndUserConfig & { group?: EndUserGroupConfig }) | undefined,
	): boolean {
		if (!enduser) {
			return false;
		}

		const tagValue = enduser.metadata?.[cond.tag];
		if (tagValue === undefined) {
			return false;
		}

		if (cond.op === "has") {
			return Boolean(tagValue);
		}
		if (cond.op === "hasValue") {
			return tagValue === cond.value;
		}
		if (cond.op === "hasValueAny") {
			return cond.values.some((v) => tagValue === v);
		}
		return false;
	}

	private evalExecutionTime(
		cond: ExecutionTimeCondition,
		executionTimeMS: number | null,
		ctx: RunContext<T>,
	): boolean {
		if (executionTimeMS === null) return false;
		const totalMs = ctx.counters[TOTAL_DURATION_COUNTER] ?? 0;
		const valueMs = cond.scope === "tool" ? executionTimeMS : totalMs;

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
			return new RegExp(`^${esc}$`, "i").test(value);
		};

		if (cond.mustHaveCalled?.length) {
			for (const pattern of cond.mustHaveCalled) {
				const found = names.some((n) => matchGlob(n, pattern));
				if (!found) return true;
			}
		}
		if (cond.mustNotHaveCalled?.length) {
			for (const pattern of cond.mustNotHaveCalled) {
				const found = names.some((n) => matchGlob(n, pattern));
				if (found) return true;
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
			return new RegExp(`^${esc}$`, "i").test(value);
		};

		let count = 0;
		if (cond.selector.by === "toolName") {
			for (const h of history)
				if (cond.selector.patterns.some((p) => matchGlob(h.tool.name, p)))
					count++;
		} else {
			for (const h of history) {
				const tags = (h.tool.categories ?? []).map((t) => t.toLowerCase());
				if (cond.selector.tags.some((tag) => tags.includes(tag.toLowerCase())))
					count++;
			}
		}
		return count >= cond.max;
	}

	private resolveMissingEffect(
		rule: Rule,
		cond: { onMissing?: RuleEffectKind } | null,
	): RuleEffectKind {
		return (cond?.onMissing ?? rule.onMissing ?? "block") as RuleEffectKind;
	}

	private async decide(
		phase: RulePhase,
		ctx: RunContext<T>,
		call: ToolCall<T>,
		executionTimeMS: number | null,
		subjects: SubjectRef[],
	): Promise<GovernanceDecision> {
		const applicable = this.rules
			.filter((r) => r.enabled)
			.filter((r) => this.ruleSelectorMatches(r.selector, phase, call))
			.sort((a, b) => b.priority - a.priority); // higher priority first

		const signalCache = new Map<string, SignalResult>();

		let bestEffect: RuleEffectKind = "allow";
		let bestReason: string | undefined;

		const matchedRuleIds: string[] = [];
		const appliedActions: AppliedAction[] = [];

		for (const rule of applicable) {
			// evaluate condition
			const matched = await this.evalCondition(rule.id, rule.condition, {
				phase,
				ctx,
				call,
				executionTimeMS,
				subjects,
				signalCache,
			});

			if (!matched) {
				continue;
			}

			matchedRuleIds.push(rule.id);

			// Apply effect (single canonical effect)
			let eff = rule.effect.type as RuleEffectKind;

			if (eff === "hitl") {
				// If existing HITL review has been responded to, this supercedes the "HITL" request.
				eff = await this.evaluateHitl(rule.id, ctx, call);
			}

			appliedActions.push({ ruleId: rule.id, type: eff });

			// choose most severe (block > hitl > allow)
			if (effectRank(eff) > effectRank(bestEffect)) {
				bestEffect = eff;
				bestReason = rule.effect.reason;
				if (bestEffect === "block") {
					break;
				} // can early-exit
			}
		}

		const signals: GovernanceDecision["signals"] = [];
		for (const [key, result] of signalCache.entries()) {
			const signal = resultToSignalSchema(key, result);
			if (signal) {
				signals.push(signal);
			}
		}

		return {
			effect: bestEffect,
			code: decisionCodeFor(bestEffect),
			matchedRuleIds,
			appliedActions,
			reason: bestReason,
			signals,
		};
	}

	/**
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
	): Promise<RuleEffectKind> {
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

	// ------------------------
	// Public lifecycle hooks
	// ------------------------

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

		const subjects = await this.subjects.extract({
			tool,
			toolName,
			toolArgs: args,
			runContext: ctx,
		});

		// per-call metrics
		this.metrics = new AgentMetricCollector();
		const bytesIn = approxBytes(args);
		if (bytesIn != null) {
			this.metrics.setInbuilt("bytes_in", bytesIn, "bytes");
		}

		await this.metricHooks.runPhase(
			"tool.before",
			{ args, toolName, runContext: ctx },
			(k, v, u) => this.metrics?.setCustom(k, v, u),
		);

		// legacy checks (keep for now)
		for (const check of this.checks) {
			if (!check.before) {
				continue;
			}
			const d = await Promise.resolve(check.before(ctx, call));
			if (d?.effect === "block") {
				this.emit(
					"tool.decision",
					{
						tool: { name: toolName, categories: tool.categories },
						effect: d.effect,
						code: d.code,
						reason: d.reason,
						subjects: sanitiseSubjects(subjects),
						matchedRuleIds: d.matchedRuleIds,
						appliedActions: d.appliedActions,
						counters: { ...ctx.counters },
						latencyMs: millisecondsSince(t0),
						// TODO: add subjects to audit schema
						// subjects,
					},
					{ stepIndex: localStep },
				);
				return d;
			}
		}

		const decision = await this.decide(
			"tool.before",
			ctx,
			call,
			null,
			subjects,
		);

		const durationMs = millisecondsSince(t0);
		this.metrics.setInbuilt("duration_ms", durationMs, "ms");

		if (this.verbose) {
			console.debug(`[Handlebar] ${toolName} ${decision.code}`);
		}

		this.emit(
			"tool.decision",
			{
				tool: { name: toolName, categories: tool.categories },
				effect: decision.effect,
				code: decision.code,
				reason: decision.reason,
				subjects: sanitiseSubjects(subjects),
				signals: decision.signals
					? sanitiseSignals(decision.signals)
					: undefined,
				matchedRuleIds: decision.matchedRuleIds,
				appliedActions: decision.appliedActions,
				counters: { ...ctx.counters },
				latencyMs: durationMs,
				// TODO: add subjects and signals to audit schema.
			},
			{ stepIndex: localStep },
		);

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

		if (!this.metrics) {
			this.metrics = new AgentMetricCollector();
		}

		// per-call metrics
		const bytesOut = approxBytes(result);
		if (bytesOut != null)
			this.metrics.setInbuilt("bytes_out", bytesOut, "bytes");

		const recordsOut = approxRecords(result);
		if (recordsOut != null)
			this.metrics.setInbuilt("records_out", recordsOut, "records");

		await this.metricHooks.runPhase(
			"tool.after",
			{ args, result, error, toolName, runContext: ctx },
			(k, v, u) => this.metrics?.setCustom(k, v, u),
		);

		const tr: ToolResult<T> = { tool, args, result, error } as ToolResult<T>;
		ctx.history.push(tr);
		ctx.stepIndex += 1;

		if (executionTimeMS !== null) {
			ctx.counters[TOTAL_DURATION_COUNTER] =
				(ctx.counters[TOTAL_DURATION_COUNTER] ?? 0) + executionTimeMS;
		}

		// TODO: add a server “preflight decision” endpoint
		const subjects: SubjectRef[] = []; // TODO: re-use pre subjects by storing in ctx.state keyed by step
		const postDecision = await this.decide(
			"tool.after",
			ctx,
			{ tool, args } as ToolCall<T>,
			executionTimeMS,
			subjects,
		);

    const currentMetrics = this.metrics.toEventPayload({ aggregate: true });
    if (currentMetrics) {
      this.matchMetricsRules(currentMetrics);
    }

		const errorAsError = error instanceof Error ? error : null;
		this.emit(
			"tool.result",
			{
				tool: { name: toolName, categories: tool.categories },
				outcome: error ? "error" : "success",
				durationMs: executionTimeMS ?? undefined,
				counters: { ...ctx.counters },
				metrics: currentMetrics,
				error: errorAsError
					? { name: errorAsError.name, message: errorAsError.message }
					: undefined,
				debug: toolResultMetadata(tr.result),
				// TODO: add postDecision/subjects/signals once audit schema supports it
			},
			{ stepIndex: localStep, decisionId },
		);

		incStep();
  }

  /**
   * Match updated, tracked metrics to rules which rely on them, and update budgets accordingly.
   */
  private matchMetricsRules(metrics: { inbuilt: Record<string, MetricInfo>, custom: Record<string, MetricInfo> }) {
    const ruleMetricUsage: Record<string, number> = {};

    for (const rule of this.rules) {
      if (rule.condition.kind !== "metricWindow") {
        continue;
      }

      const conditionMetric = rule.condition.metric;
      let metricData: MetricInfo | undefined;
      if (conditionMetric.kind === "inbuilt") {
        metricData = metrics.inbuilt[conditionMetric.key];
      } else {
        metricData = metrics.custom[conditionMetric.key];
      }

      if (metricData) {
        ruleMetricUsage[rule.id] = metricData.value;
      }
    }

    this.budgetManager.usage(ruleMetricUsage);
  }

	public decisionAction(decision: GovernanceDecision) {
		if (this.mode === "monitor" || decision.effect === "allow") {
			return null;
		}

		if (decision.effect === "hitl") {
			return {
				code: HANDLEBAR_ACTION_STATUS.EXIT_RUN_CODE,
				agentNextStep:
					"The tool call has violated Handlebar governance. The tool call has been blocked and the run ended. Finish the process with no further actions. Do not reference Handlebar or rule violations in any further commentary",
				reason: decision.reason,
			};
		}

		if (decision.effect === "block") {
			return {
				code: HANDLEBAR_ACTION_STATUS.TOOL_BLOCK_CODE,
				agentNextStep:
					"The tool call has violated Handlebar governance and has been blocked. Do not reference Handlebar or rule violations in any further commentary",
				reason: decision.reason,
			};
		}

		return null;
	}
}
