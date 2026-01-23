import type {
  rulesV2,
  ToolNameCondition,
  ToolTagCondition,
  EndUserTagCondition,
  ExecutionTimeCondition,
  SequenceCondition,
  MaxCallsCondition,
  EndUserConfig,
  EndUserGroupConfig,
} from "@handlebar/governance-schema";

import type { GovernanceDecision, AppliedAction } from "@handlebar/governance-schema";
import type { AuditBus } from "./audit/bus";
import { ApiManager } from "./api/manager";
import { emit } from "./audit";
import { getRunContext, incStep } from "./audit/context";
import type { CustomCheck, GovernanceConfig, RunContext, Tool, ToolCall, ToolMeta, ToolResult } from "./types";
import { millisecondsSince } from "./utils";
import type { AgentTool } from "./api/types";
import { approxBytes, approxRecords, AgentMetricCollector, AgentMetricHookRegistry, type AgentMetricHook, type AgentMetricHookPhase } from "./metrics";

// ------------------------
// Subjects + Signals (MVP)
// ------------------------

export type SubjectRef = {
  subjectType: string;
  role?: string;          // "primary" | "source" | "dest"
  id: string;
  idSystem?: string;      // "ehr_patient_id" etc
};

export type SubjectExtractor<T extends Tool = Tool> = (args: {
  tool: ToolMeta<T>;
  toolName: string;
  toolArgs: unknown;
  runContext: RunContext<T>;
}) => SubjectRef[] | Promise<SubjectRef[]>;

export type SignalProvider = (args: Record<string, unknown>) => unknown | Promise<unknown>;

type SignalResult =
  | { key: string; ok: true; value: unknown }
  | { key: string; ok: false; error: unknown };

function effectRank(effect: rulesV2.RuleEffectKind): number {
  // higher = more severe
  if (effect === "block") return 3;
  if (effect === "hitl") return 2;
  return 1; // allow
}

function decisionCodeFor(effect: rulesV2.RuleEffectKind): GovernanceDecision["code"] {
  switch (effect) {
    case "block":
      return "BLOCKED_RULE";
    case "hitl":
      return "BLOCKED_HITL_REQUESTED";
    default:
      return "ALLOWED";
  }
}

function nowToTimeParts(nowMs: number, timeZone: string): { dow: string; hhmm: string } {
  // Dow: mon/tue/...
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(nowMs));
  const weekday = parts.find(p => p.type === "weekday")?.value ?? "Mon";
  const hour = parts.find(p => p.type === "hour")?.value ?? "00";
  const minute = parts.find(p => p.type === "minute")?.value ?? "00";

  const dow = weekday.toLowerCase().slice(0, 3); // "mon"
  return { dow, hhmm: `${hour}:${minute}` };
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  const hh = Number(h);
  const mm = Number(m);
  return hh * 60 + mm;
}

function compare(op: rulesV2.SignalCondition["op"], left: unknown, right: unknown): boolean {
  // very MVP: handle primitives + in/nin over arrays
  switch (op) {
    case "eq":  return left === right;
    case "neq": return left !== right;
    case "gt":  return typeof left === "number" && typeof right === "number" && left > right;
    case "gte": return typeof left === "number" && typeof right === "number" && left >= right;
    case "lt":  return typeof left === "number" && typeof right === "number" && left < right;
    case "lte": return typeof left === "number" && typeof right === "number" && left <= right;
    case "in": {
      if (!Array.isArray(right)) return false;
      return right.some(v => v === left);
    }
    case "nin": {
      if (!Array.isArray(right)) return false;
      return !right.some(v => v === left);
    }
    default:
      return false;
  }
}

function getByDotPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split(".").filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

type EvalArgs<T extends Tool = Tool> = {
  phase: rulesV2.RulePhase;
  ctx: RunContext<T>;
  call: ToolCall<T>;
  executionTimeMS: number | null;
  subjects: SubjectRef[];
  // per-call caches
  signalCache: Map<string, SignalResult>;
};

// ------------------------
// Engine (V2 rules)
// ------------------------

const TOTAL_DURATION_COUNTER = "__hb_totalDurationMs";

export class GovernanceEngine<T extends Tool = Tool> {
  private tools: Map<string, ToolMeta<T>>;
  private rulesV2: rulesV2.RuleV2[];
  private checks: CustomCheck<T>[];
  private mode: "monitor" | "enforce";
  private verbose: boolean;

  private api: ApiManager;

  // per-tool-call collector (do not keep globally)
  private metrics: AgentMetricCollector | null;
  private metricHooks: AgentMetricHookRegistry;

  // registries
  private subjectExtractorsByToolName = new Map<string, SubjectExtractor<T>>();
  private signalProvidersByKey = new Map<string, SignalProvider>();

  constructor(cfg: GovernanceConfig<T>, public bus?: AuditBus) {
    this.tools = new Map(cfg.tools.map((t) => [t.name, t]));
    this.rulesV2 = cfg.rules ?? [];
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

    this.rulesV2.push(...((output.rules ?? []) as rulesV2.RuleV2[]));
    return output.agentId;
  }

  public registerMetric<P extends AgentMetricHookPhase>(hook: AgentMetricHook<P>) {
    this.metricHooks.registerHook(hook);
  }

  public registerSubjectExtractor(toolName: string, extractor: SubjectExtractor<T>) {
    this.subjectExtractorsByToolName.set(toolName, extractor);
  }

  public registerSignal(key: string, provider: SignalProvider) {
    this.signalProvidersByKey.set(key, provider);
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

  private ruleSelectorMatches(ruleSel: rulesV2.RuleSelector, phase: rulesV2.RulePhase, call: ToolCall<T>): boolean {
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

  private async extractSubjects(ctx: RunContext<T>, call: ToolCall<T>): Promise<SubjectRef[]> {
    const extractor = this.subjectExtractorsByToolName.get(call.tool.name);
    if (!extractor) { return []; }
    try {
      const out = await Promise.resolve(extractor({
        tool: call.tool,
        toolName: call.tool.name,
        toolArgs: call.args,
        runContext: ctx,
      }));
      return Array.isArray(out) ? out : [];
    } catch {
      return [];
    }
  }

  private bindSignalArg<TTool extends Tool>(
    binding: any,
    args: EvalArgs<TTool>,
  ): unknown {
    switch (binding?.from) {
      // TODO: rename to endUserExternalId to clarify that it's not a Handlebar ID.
      case "endUserId":
        return args.ctx.enduser?.externalId;

      case "toolArg":
        return getByDotPath(args.call.args, binding.path);

      case "subject": {
        const matches = args.subjects.filter(s => s.subjectType === binding.subjectType)
          .filter(s => (binding.role ? s.role === binding.role : true));
        const s0 = matches[0];
        if (!s0) { return undefined; }
        const field = binding.field ?? "id";
        return field === "idSystem" ? s0.idSystem : s0.id;
      }

      case "const":
        return binding.value;

      case "endUserTag": {
        const enduser = args.ctx.enduser;
        return enduser?.metadata?.[binding.tag];
      }
      case "toolName":
        return args.call.tool.name;
      case "toolTag": {
        const tags = (args.call.tool.categories ?? []).map((t: string) => t.toLowerCase());
        return tags.includes(String(binding.tag).toLowerCase());
      }

      default:
        return undefined;
    }
  }

  private async evalSignalCondition(cond: rulesV2.SignalCondition, args: EvalArgs<T>): Promise<boolean> {
    const provider = this.signalProvidersByKey.get(cond.key);
    if (!provider) {
      // missing signal provider => onMissing effect applies at rule-level; condition is "unknown"
      return false;
    }

    const boundArgs: Record<string, unknown> = {};
    for (const [k, b] of Object.entries(cond.args ?? {})) {
      boundArgs[k] = this.bindSignalArg(b, args);
    }

    const cacheKey = `${cond.key}:${JSON.stringify(boundArgs)}`;
    const cached = args.signalCache.get(cacheKey);
    if (cached) {
      if (!cached.ok) return false;
      return compare(cond.op, cached.value, cond.value);
    }

    try {
      const value = await Promise.resolve(provider(boundArgs));
      args.signalCache.set(cacheKey, { key: cond.key, ok: true, value });
      return compare(cond.op, value, cond.value);
    } catch (err) {
      args.signalCache.set(cacheKey, { key: cond.key, ok: false, error: err });
      return false;
    }
  }

  private evalRequireSubject(cond: rulesV2.RequireSubjectCondition, subjects: SubjectRef[]): boolean {
    const matches = subjects.filter(s => s.subjectType === cond.subjectType);
    if (!matches.length) return false;
    if (cond.idSystem) return matches.some(s => s.idSystem === cond.idSystem);
    return true;
  }

  private evalTimeGate(cond: rulesV2.TimeGateCondition, ctx: RunContext<T>): boolean {
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

  private async evalCondition(cond: rulesV2.RuleConditionV2, args: EvalArgs<T>): Promise<boolean> {
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
        return this.evalTimeGate(cond as rulesV2.TimeGateCondition, args.ctx);

      case "requireSubject":
        return this.evalRequireSubject(cond as rulesV2.RequireSubjectCondition, args.subjects);

      case "signal":
        return this.evalSignalCondition(cond as rulesV2.SignalCondition, args);

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

  // ------------------------
  // V2 decision evaluation
  // ------------------------

  private resolveMissingEffect(rule: rulesV2.RuleV2, cond: { onMissing?: rulesV2.RuleEffectKind } | null): rulesV2.RuleEffectKind {
    return (cond?.onMissing ?? rule.onMissing ?? "block") as rulesV2.RuleEffectKind;
  }

  private async decide(
    phase: rulesV2.RulePhase,
    ctx: RunContext<T>,
    call: ToolCall<T>,
    executionTimeMS: number | null,
    subjects: SubjectRef[],
  ): Promise<GovernanceDecision> {
    const applicable = this.rulesV2
      .filter(r => r.enabled)
      .filter(r => this.ruleSelectorMatches(r.selector, phase, call))
      .sort((a, b) => b.priority - a.priority); // higher priority first

    const signalCache = new Map<string, SignalResult>();

    let bestEffect: rulesV2.RuleEffectKind = "allow";
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
      const eff = rule.effect.type as rulesV2.RuleEffectKind;
      appliedActions.push({ ruleId: rule.id, type: eff });

      // choose most severe (block > hitl > allow)
      if (effectRank(eff) > effectRank(bestEffect)) {
        bestEffect = eff;
        bestReason = rule.effect.reason;
        if (bestEffect === "block") { break; } // can early-exit
      }
    }

    return {
      effect: bestEffect,
      code: decisionCodeFor(bestEffect),
      matchedRuleIds,
      appliedActions,
      reason: bestReason,
    };
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

    // subjects first so rules can use them
    const subjects = await this.extractSubjects(ctx, call);

    // per-call metrics
    this.metrics = new AgentMetricCollector();
    const bytesIn = approxBytes(args);
    if (bytesIn != null) this.metrics.setInbuilt("bytes_in", bytesIn, "bytes");

    await this.metricHooks.runPhase(
      "tool.before",
      { args, toolName, runContext: ctx },
      (k, v, u) => this.metrics?.setCustom(k, v, u),
    );

    // legacy checks (keep for now)
    for (const check of this.checks) {
      if (!check.before) continue;
      const d = await Promise.resolve(check.before(ctx, call));
      if (d && d.effect === "block") {
        this.emit(
          "tool.decision",
          {
            tool: { name: toolName, categories: tool.categories },
            effect: d.effect,
            code: d.code,
            reason: d.reason,
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
    return this.mode === "enforce" && decision.effect === "block";
  }
}
