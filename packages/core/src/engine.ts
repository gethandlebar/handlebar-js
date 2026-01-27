import type {
  EndUserConfig,
  EndUserGroupConfig,
  GovernanceDecision,
  AppliedAction,
  EndUserTagCondition,
  ExecutionTimeCondition,
  MaxCallsCondition,
  RequireSubjectCondition,
  Rule,
  RuleCondition,
  RuleEffectKind,
  RulePhase,
  RuleSelector,
  SequenceCondition,
  SignalCondition,
  TimeGateCondition,
  ToolNameCondition,
  ToolTagCondition
} from "@handlebar/governance-schema";
import type { AuditBus } from "./audit/bus";
import { ApiManager } from "./api/manager";
import { emit } from "./audit";
import { getRunContext, incStep } from "./audit/context";
import type { CustomCheck, GovernanceConfig, RunContext, Tool, ToolCall, ToolMeta, ToolResult } from "./types";
import { millisecondsSince } from "./utils";
import type { AgentTool } from "./api/types";
import { approxBytes, approxRecords, AgentMetricCollector, AgentMetricHookRegistry, type AgentMetricHook, type AgentMetricHookPhase } from "./metrics";
import { SubjectRegistry, type SubjectRef } from "./subjects";
import { compareSignal, SignalRegistry, type SignalProvider, type SignalResult } from "./signals";
import { hhmmToMinutes, nowToTimeParts } from "./time";
import { decisionCodeFor, effectRank } from "./actions";

type EvalArgs<T extends Tool = Tool> = {
  phase: RulePhase;
  ctx: RunContext<T>;
  call: ToolCall<T>;
  executionTimeMS: number | null;
  subjects: SubjectRef[];
  // per-call caches
  signalCache: Map<string, SignalResult>;
};

const TOTAL_DURATION_COUNTER = "__hb_totalDurationMs";

export class GovernanceEngine<T extends Tool = Tool> {
  private tools: Map<string, ToolMeta<T>>;
  private rules: Rule[];
  private checks: CustomCheck<T>[];
  private mode: "monitor" | "enforce";
  private verbose: boolean;

  private api: ApiManager;

  // per-tool-call collector (do not keep globally)
  private metrics: AgentMetricCollector | null;
  private metricHooks: AgentMetricHookRegistry;

  // registries
  private subjects = new SubjectRegistry<T>();
  private signals = new SignalRegistry();

  constructor(cfg: GovernanceConfig<T>, public bus?: AuditBus) {
    this.tools = new Map(cfg.tools.map((t) => [t.name, t]));
    this.rules = cfg.rules ?? [];
    this.checks = cfg.checks ?? [];
    this.mode = cfg.mode ?? "enforce";
    this.verbose = Boolean(cfg.verbose);

    this.api = new ApiManager({});
    this.metrics = null;
    this.metricHooks = new AgentMetricHookRegistry();
  }

  public async initAgentRules(
    agentConfig: { slug: string; name?: string; description?: string; tags?: string[] },
    tools: AgentTool[],
  ): Promise<string | null> {
    const output = await this.api.initialiseAgent(agentConfig, tools);
    if (!output) { return null; }

    this.rules.push(...((output.rules ?? []) as Rule[]));
    return output.agentId;
  }

  public registerMetric<P extends AgentMetricHookPhase>(hook: AgentMetricHook<P>) {
    this.metricHooks.registerHook(hook);
  }

  public registerSubjectExtractor(toolName: string, extractor: Parameters<SubjectRegistry<T>["register"]>[1]) {
    this.subjects.register(toolName, extractor);
  }

  public registerSignal(key: string, provider: SignalProvider) {
    this.signals.register(key, provider);
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

  public emit<K extends any>(kind: any, data: any, extras?: any): void {
    if (!this.api.agentId) return;
    emit(this.api.agentId, kind, data, extras);
  }

  getTool(name: string) {
    const t = this.tools.get(name);
    if (!t) throw new Error(`Unknown tool "${name}"`);
    return t;
  }

  private ruleSelectorMatches(ruleSel: RuleSelector, phase: RulePhase, call: ToolCall<T>): boolean {
    if (ruleSel.phase !== phase) { return false; }

    const toolSel = ruleSel.tool;
    if (!toolSel) { return true; }

    const toolName = call.tool.name;
    const toolTags = (call.tool.categories ?? []);

    const matchGlob = (value: string, pattern: string): boolean => {
      const esc = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${esc}$`, "i").test(value);
    };

    if (toolSel.name) {
      const patterns = Array.isArray(toolSel.name) ? toolSel.name : [toolSel.name];
      const ok = patterns.some(p => matchGlob(toolName, p));
      if (!ok) return false;
    }

    if (toolSel.tagsAll?.length) {
      const lower = toolTags.map(t => t.toLowerCase());
      if (!toolSel.tagsAll.every(t => lower.includes(t.toLowerCase()))) return false;
    }

    if (toolSel.tagsAny?.length) {
      const lower = toolTags.map(t => t.toLowerCase());
      if (!toolSel.tagsAny.some(t => lower.includes(t.toLowerCase()))) return false;
    }

    return true;
  }

  private evalRequireSubject(cond: RequireSubjectCondition, subjects: SubjectRef[]): boolean {
    const matches = subjects.filter(s => s.subjectType === cond.subjectType);
    if (!matches.length) {
      return false;
    }

    if (cond.idSystem) {
      return matches.some(s => s.idSystem === cond.idSystem);
    }

    return true;
  }

  private evalTimeGate(cond: TimeGateCondition, ctx: RunContext<T>): boolean {
    // timezone from enduserTag
    const enduser = ctx.enduser;
    const tzTag = cond.timezone?.source === "endUserTag" ? cond.timezone.tag : undefined;
    const tz = tzTag ? enduser?.metadata?.[tzTag] : undefined;

    // fallback "org" not implemented in MVP client. If missing => fail closed.
    if (typeof tz !== "string" || tz.length === 0) { return false; }

    if (typeof tz !== "string" || !tz.length) return false;

    const { dow, hhmm } = nowToTimeParts(ctx.now(), tz);
    const nowMin = hhmmToMinutes(hhmm);

    for (const w of cond.windows) {
      if (!w.days.includes(dow as any)) continue;
      const startMin = hhmmToMinutes(w.start);
      const endMin = hhmmToMinutes(w.end);
      if (startMin <= nowMin && nowMin <= endMin) return true;
    }
    return false;
  }

  private async evalCondition(cond: RuleCondition, args: EvalArgs<T>): Promise<boolean> {
    switch (cond.kind) {
      case "toolName":
        return this.evalToolName(cond as ToolNameCondition, args.call.tool.name);

      case "toolTag":
        return this.evalToolTag(cond as ToolTagCondition, args.call.tool.categories ?? []);

      case "enduserTag":
        return this.evalEnduserTag(cond as EndUserTagCondition, args.ctx.enduser);

      case "executionTime":
        if (args.phase !== "tool.after") { return false; }
        return this.evalExecutionTime(cond as ExecutionTimeCondition, args.executionTimeMS, args.ctx);

      case "sequence":
        return this.evalSequence(cond as SequenceCondition, args.ctx.history, args.call.tool.name);

      case "maxCalls":
        return this.evalMaxCalls(cond as MaxCallsCondition, args.ctx.history);

      case "timeGate":
        return this.evalTimeGate(cond as TimeGateCondition, args.ctx);

      case "requireSubject":
        return this.evalRequireSubject(cond as RequireSubjectCondition, args.subjects);

      case "signal": {
        const c = cond as SignalCondition;

        const res = await this.signals.eval(
          c.key,
          c.args,
          { ctx: args.ctx, call: args.call, subjects: args.subjects },
          args.signalCache,
        );

        if (!res.ok) {
          // missing provider / error: treat as "not matched" locally.
          return false;
        }

        return compareSignal(c.op, res.value, c.value);
      }

      case "metricWindow":
        // server-enforced: cannot evaluate client-side => do NOT match rule locally.
        return false;

      case "custom":
        // Prefer signals over custom functions in V2; treat as not supported in core.
        return false;

      case "and": {
        const c = cond;
        if (!c.all.length) { return true; }
        for (const child of c.all) { if (!(await this.evalCondition(child, args))) { return false; } }
        return true;
      }
      case "or": {
        const c = cond;
        if (!c.any.length) { return false; }
        for (const child of c.any) { if (await this.evalCondition(child, args)) { return true; } }
        return false;
      }
      case "not":
        return !(await this.evalCondition(cond.not, args));

      default:
        return true;
    }
  }

  private evalToolName(cond: ToolNameCondition, toolName: string): boolean {
    const name = toolName.toLowerCase();
    const matchGlob = (value: string, pattern: string): boolean => {
      const esc = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${esc}$`, "i").test(value);
    };
    switch (cond.op) {
      case "eq": return name === cond.value.toString().toLowerCase();
      case "neq": return name !== cond.value.toString().toLowerCase();
      case "contains": return name.includes(cond.value.toString().toLowerCase());
      case "startsWith": return name.startsWith(cond.value.toString().toLowerCase());
      case "endsWith": return name.endsWith(cond.value.toString().toLowerCase());
      case "glob": return matchGlob(name, cond.value as string);
      case "in": return cond.value.some((v) => matchGlob(name, v as string));
    }
  }

  private evalToolTag(cond: ToolTagCondition, tags: string[]): boolean {
    const lower = tags.map((t) => t.toLowerCase());
    switch (cond.op) {
      case "has": return lower.includes(cond.tag.toLowerCase());
      case "anyOf": return cond.tags.some((t) => lower.includes(t.toLowerCase()));
      case "allOf": return cond.tags.every((t) => lower.includes(t.toLowerCase()));
    }
  }

  private evalEnduserTag(
    cond: EndUserTagCondition,
    enduser: (EndUserConfig & { group?: EndUserGroupConfig }) | undefined,
  ): boolean {
    if (!enduser) { return false; }

    const tagValue = enduser.metadata[cond.tag];
    if (tagValue === undefined) return false;

    if (cond.op === "has") { return Boolean(tagValue); }
    if (cond.op === "hasValue") { return tagValue === cond.value; }
    if (cond.op === "hasValueAny") { return cond.values.some((v) => tagValue === v); }
    return false;
  }

  private evalExecutionTime(cond: ExecutionTimeCondition, executionTimeMS: number | null, ctx: RunContext<T>): boolean {
    if (executionTimeMS === null) return false;
    const totalMs = ctx.counters[TOTAL_DURATION_COUNTER] ?? 0;
    const valueMs = cond.scope === "tool" ? executionTimeMS : totalMs;

    switch (cond.op) {
      case "gt": return valueMs > cond.ms;
      case "gte": return valueMs >= cond.ms;
      case "lt": return valueMs < cond.ms;
      case "lte": return valueMs <= cond.ms;
      case "eq": return valueMs === cond.ms;
      case "neq": return valueMs !== cond.ms;
    }
  }

  private evalSequence(cond: SequenceCondition, history: ToolResult<T>[], currentToolName: string): boolean {
    const names = history.map((h) => h.tool.name);
    const matchGlob = (value: string, pattern: string): boolean => {
      const esc = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*");
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

  private evalMaxCalls(cond: MaxCallsCondition, history: ToolResult<T>[]): boolean {
    const matchGlob = (value: string, pattern: string): boolean => {
      const esc = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${esc}$`, "i").test(value);
    };

    let count = 0;
    if (cond.selector.by === "toolName") {
      for (const h of history) if (cond.selector.patterns.some((p) => matchGlob(h.tool.name, p))) count++;
    } else {
      for (const h of history) {
        const tags = (h.tool.categories ?? []).map((t) => t.toLowerCase());
        if (cond.selector.tags.some((tag) => tags.includes(tag.toLowerCase()))) count++;
      }
    }
    return count >= cond.max;
  }

  private resolveMissingEffect(rule: Rule, cond: { onMissing?: RuleEffectKind } | null): RuleEffectKind {
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
      .filter(r => r.enabled)
      .filter(r => this.ruleSelectorMatches(r.selector, phase, call))
      .sort((a, b) => b.priority - a.priority); // higher priority first

    const signalCache = new Map<string, SignalResult>();

    let bestEffect: RuleEffectKind = "allow";
    let bestReason: string | undefined;

    const matchedRuleIds: string[] = [];
    const appliedActions: AppliedAction[] = [];

    for (const rule of applicable) {
      // evaluate condition
      const matched = await this.evalCondition(rule.condition, {
        phase,
        ctx,
        call,
        executionTimeMS,
        subjects,
        signalCache,
      });

      if (!matched) { continue; }

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
        if (bestEffect === "block") { break; } // can early-exit
      }
    }

    const signalValues = Array.from(signalCache.values());
    return {
      effect: bestEffect,
      code: decisionCodeFor(bestEffect),
      matchedRuleIds,
      appliedActions,
      reason: bestReason,
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

  async beforeTool(ctx: RunContext<T>, toolName: string, args: unknown): Promise<GovernanceDecision> {
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
            subjects,
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

    const decision = await this.decide("tool.before", ctx, call, null, subjects);

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
        subjects,
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
    if (bytesOut != null) this.metrics.setInbuilt("bytes_out", bytesOut, "bytes");

    const recordsOut = approxRecords(result);
    if (recordsOut != null) this.metrics.setInbuilt("records_out", recordsOut, "records");

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
    const postDecision = await this.decide("tool.after", ctx, { tool, args } as ToolCall<T>, executionTimeMS, subjects);

    const currentMetrics = this.metrics.toEventPayload({ aggregate: true });

    const errorAsError = error instanceof Error ? error : null;
    this.emit(
      "tool.result",
      {
        tool: { name: toolName, categories: tool.categories },
        outcome: error ? "error" : "success",
        durationMs: executionTimeMS ?? undefined,
        counters: { ...ctx.counters },
        metrics: currentMetrics,
        error: errorAsError ? { name: errorAsError.name, message: errorAsError.message } : undefined,
        // TODO: add postDecision/subjects/signals once audit schema supports it
      },
      { stepIndex: localStep, decisionId },
    );

    incStep();
  }

  shouldBlock(decision: GovernanceDecision) {
    // For now, HITL is automatically a run-ender.
    return this.mode === "enforce" && (decision.effect === "block" || decision.effect === "hitl");
  }
}
