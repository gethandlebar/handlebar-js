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

### Phase 0 — Governance schema updates ✅
- [x] Add `Verdict`, `RunControl`, `DecisionCause`, `RuleEval`, `Decision` Zod schemas to `governance-actions.ts`
- [x] Add `sessionId`, `actorExternalId` to `AuditEnvelopeSchema` (additive, backward compat)
- [x] Add `actor` field to `RunStartedEventSchema` alongside `enduser`
- [x] Extend `RunEndedEventSchema` status with `"success" | "timeout" | "interrupted"`
- [x] Add new verdict fields to `ToolDecisionEventSchema` as optional (superset)
- [x] All 273 existing core tests pass after schema changes

### Phase 1 — Core types (`new_core/types.ts`) ✅
- [x] `HandlebarConfig`, `RunConfig`, `Tool`, `Actor`, `EnforceMode`
- [x] Decision types re-exported from governance-schema
- [x] `FAILOPEN_DECISION`, `FAILCLOSED_DECISION` constants
- [x] `RunEndStatus`, sink config types
- [x] LLM types: `LLMMessage`, `LLMResponse`, `LLMResponsePart`, `ModelInfo`, `TokenUsage`
- [x] `deriveOutputText()` utility

### Phase 2 — Sink subsystem (`new_core/sinks/`) ✅
- [x] `Sink` interface
- [x] `SinkBus` — fan-out, error isolation per sink, close propagation
- [x] `createConsoleSink` — pretty / JSON
- [x] `createHttpSink` — bounded queue, batching, exponential backoff retry, drop-oldest on overflow, flush-on-shutdown
- [x] 13 unit tests

### Phase 3 — API manager (`new_core/api/manager.ts`) ✅
- [x] `upsertAgent` — `PUT /v1/agents/{slug}` with optional tools
- [x] `registerTools` — `PUT /v1/agents/{agentId}/tools`
- [x] `startRun` — `POST /v1/runs/{runId}/start` (preflight merged; returns lockdown status)
- [x] `evaluate` — `POST /v1/runs/{runId}/evaluate`; retry + backoff; `DecisionSchema` validation; failopen/failclosed
- [x] Event ingest handled by `HttpSink` directly (not ApiManager)
- [x] 16 unit tests

### Phase 4+5 — HandlebarClient + Run ✅
- [x] `Handlebar.init(config)` factory; non-blocking async agent init; `startRun` (idempotent by runId); `registerTools`; `shutdown`
- [x] `withRun` / `getCurrentRun` ALS helpers
- [x] `Run` class — fully isolated per-instance state
  - [x] `beforeTool` — evaluate, emit `tool.decision`, honour enforceMode
  - [x] `afterTool` — evaluate with inline metrics, emit `tool.result`, increment stepIndex
  - [x] `beforeLlm` — return possibly-modified messages; emit `message.raw.created`
  - [x] `afterLlm` — re-derive outputText, emit `llm.result`, return possibly-modified response
  - [x] `end(status)` — emit `run.ended`, idempotent, clear TTL timer
  - [x] TTL auto-close via unreffed `setTimeout`
- [x] 20 unit tests

### Phase 6 — Tool wrapper (`new_core/tool.ts`) ✅
- [x] `wrapTool(tool, meta)` — overlays tags/description onto any `{ name: string }` tool; preserves original properties
- [x] `defineTool(name, meta)` — inline tool descriptor for use without a framework
- [x] 9 unit tests

### Phase 7 — Migration
- [ ] Audit existing `GovernanceEngine` public API surface for parity gaps
- [ ] Update `@handlebar/ai-sdk-v5` to use new core (after new_core stabilises)
- [ ] Deprecation path for old `GovernanceEngine`

### Phase 8 — Framework integration guide
- [ ] Map lifecycle hooks to Vercel AI v6 (`onStepFinish`, `experimental_transform`)
- [ ] Map lifecycle hooks to LangChain JS (`handleToolStart`, `handleToolEnd`, `handleLLMStart`, `handleLLMEnd`)
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
