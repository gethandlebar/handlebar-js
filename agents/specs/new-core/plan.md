# New Core — Implementation Plan

Work directory: `packages/core/src/new_core/`

---

## Design questions — resolved

- [x] Q1: `REWRITE` verdict — out of scope, removed from type
- [x] Q2: Local decision cache — deferred, no local cache in new core
- [x] Q3: `PAUSE` — deferred; `TERMINATE` replaces `EXIT_RUN_CODE`; HITL expressed via `cause.kind = "HITL_PENDING"` + `verdict = "BLOCK"`
- [x] Q4: Preflight — merged into `POST /v1/runs/{run_id}/start`; separate preflight endpoint removed
- [x] Q5: `actor` going forward; existing `EndUserConfig` typing retained in governance-schema
- [x] Q6: `beforeLlm` returns `Promise<LLMMessage[]>`; `afterLlm` returns `Promise<LLMResponse>`; model info passed as separate `meta` param; provider token usage is canonical over client estimates
- [x] Q7: `RunEndStatus = "success" | "error" | "timeout" | "interrupted"`
- [x] Q8: `evaluatedRules: RuleEval[]` is required on Decision; `matchedRuleIds`/`violatedRuleIds` top-level fields removed

## Remaining open design question

- [x] Q9: `LLMResponse` type shape — fully normalised. See `design.md` for resolved type definition.

---

## Implementation checklist

### Phase 0 — Governance schema updates
- [ ] Propose updated `AuditEvent` schemas for new `Decision` shape (`tool.decision` event)
- [ ] Confirm `EndUserConfig` / actor naming and update schema if required

### Phase 1 — Core types and interfaces (`new_core/types.ts`)
- [ ] Define `HandlebarConfig` (global init options: apiKey, endpoint, failclosed, enforceMode, sinks)
- [ ] Define `RunConfig` (runId, sessionId, actor, tags, context, runTtlMs)
- [ ] Define `Tool` shape — framework-agnostic, no Vercel AI assumptions
- [ ] Define `Decision` / `Verdict` / `RunControl` / `Cause` / `RuleEval` types (client-side mirror of server contract)
- [ ] Define sink interfaces (`Sink`, `SinkEvent`)
- [ ] Define lifecycle hook return types (including whether `beforeLlm` can return modified data)

### Phase 2 — Sink subsystem (`new_core/sinks/`)
- [ ] `HttpSink` — bounded in-memory queue, configurable depth, exponential backoff retry, flush-on-shutdown
- [ ] `ConsoleSink` — pretty / JSON modes
- [ ] `SinkBus` — fan-out to multiple sinks, error isolation per sink
- [ ] Unit tests: queue overflow, retry, flush

### Phase 3 — API manager (`new_core/api/`)
- [ ] `ApiManager` class — all Handlebar API interactions
  - [ ] `PUT /v1/agents/{agent-slug}` — upsert agent, return agent ID
  - [ ] `PUT /v1/agents/{agent_id}/tools` — register tools
  - [ ] `POST /v1/agents/{agent_id}/preflight` — lockdown + budget check
  - [ ] `POST /v1/runs/{run_id}/evaluate` — send tool call, get Decision
  - [ ] `POST /v1/runs/{run_id}/events` — audit event ingest
- [ ] Failopen / failclosed logic on API unavailability
- [ ] Retry with backoff for evaluate and events calls
- [ ] Unit tests: failopen/failclosed path, retry logic, timeout handling

### Phase 4 — HandlebarClient (`new_core/client.ts`)
- [ ] `Handlebar.init(config)` — returns `HandlebarClient`
- [ ] Agent upsert + tool registration on init (or lazy on first run?)
- [ ] Preflight call on init
- [ ] ALS namespace (optional, for framework wrappers)
- [ ] `client.startRun(runConfig)` — returns a `Run`
- [ ] Idempotent run start (same runId → return existing run)
- [ ] Unit tests: concurrent init, duplicate startRun, failclosed on API down

### Phase 5 — Run object (`new_core/run.ts`)
- [ ] `Run` class — per-run lifecycle, all state isolated to instance
- [ ] Constructor emits `run.started` event via sinks
- [ ] `run.beforeTool(toolName, args)` — calls evaluate, emits `tool.decision`
- [ ] `run.afterTool(toolName, args, result, executionTimeMs, error?)` — emits `tool.result`, updates counters
- [ ] `run.beforeLlm(messages)` — emits event, surfaces PII redaction hook (observe-only for now)
- [ ] `run.afterLlm(response)` — updates token metrics, emits `llm.result`
- [ ] `run.end(status?)` — emits `run.ended`, flushes sinks
- [ ] RunTTL auto-close
- [ ] `withRun(run, fn)` — ALS wrapper
- [ ] Idempotent lifecycle: double `end()` is a no-op
- [ ] Unit tests: concurrent runs don't bleed state, idempotent hooks, TTL expiry

### Phase 6 — Tool wrapper (`new_core/tool.ts`)
- [ ] `wrapTool(tool, meta)` — attaches tags/classification without framework coupling
- [ ] Type-safe args inference

### Phase 7 — Migration
- [ ] Audit existing `GovernanceEngine` public API surface for parity gaps
- [ ] Update `@handlebar/ai-sdk-v5` to use new core (after new_core stabilises)
- [ ] Deprecation path for old `GovernanceEngine`

### Phase 8 — Framework integration guide
- [ ] Map lifecycle hooks to Vercel AI v6 (stream/onStepFinish hooks)
- [ ] Map lifecycle hooks to LangChain JS (callbacks)
- [ ] Map lifecycle hooks to OpenAI Agents SDK for TypeScript
- [ ] Add integration examples to docs/

---

## Key implementation notes

### Concurrency fix
The current `GovernanceEngine` stores `this.metrics` (per-call state) on the class instance, which is a concurrency bug for simultaneous tool calls. The new design fixes this by keeping all per-run and per-call state on the `Run` instance.

### ALS usage
`AsyncLocalStorage` is used internally by the client for framework wrappers that can't pass `run` explicitly. The explicit `run.hook()` API is the primary contract; ALS is a convenience layer on top.

### Sink architecture
Sinks must be registered at `HandlebarClient` init time (global). Per-run sink overrides are not in scope for now.

### Rule evaluation
The new core no longer evaluates rules locally. All rule evaluation happens server-side via `POST /v1/runs/{run_id}/evaluate`. The client only handles the Decision response and emits the appropriate audit events.
