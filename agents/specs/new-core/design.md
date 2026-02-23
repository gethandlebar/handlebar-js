## Proposed interaction
Keep end-user API tiny. user calls:
- const hb = Handlebar.init(<global config>)
- const run = hb.startRun(<run specific config>)
- run.<lifecyclehook>
- run.end(status?)

The idea is to pass explicitly run around, but the `hb` having optional ASynclocalstorage managers
for flows which require it, e.g. a `withRun(run, fn)` wrapper. Handlebar-managed thin framework wrappers might likely use ALS instead.

### HandlebarClient
HandlebarClient initted with config on failclosed mode (false - default - or true), enforce mode (enforce, shadow - run and log but don't enforce - and off - don't eval policies at all).
The client can be initted with agent information (in existing shape) and enduser shape (in existing shape), which if provided will propagate down to run. Run can also accept enduser config.
HandlebarClient stores global and per-run context. Per-run context can be handled by asynclocalstorage, but also provides a `Run` producer (returns a run object and passes down global config).

### Run
config:
```
hb: HandlebarClient<TContext>;
runId: string;
sessionId?: string;
actor?: Actor; // enduser - should we use enduser or actor?
tags?: Record<string, string>;
context: TContext;
runTtlMs: number; // Lifetime after which the run is auto-closed. designed to provide an end for when users have forgotten to invoke run.end
```

Run stores current state, a log of evaluated events (regardless of outcome), and whether the process should be exited (e.g. a Handlebar rule violation means the agent should stop).
Run constructor emits sinks with run.started event. `end` method emits run.ended event to sinks. `beforeTool` hook checks policies and emits tool.decision as relevant. `afterTool` checks . `beforeLlm` and `afterLlm` hooks should update stored token metrics and have a surface for PII redaction for when it's implemented.
We need some wrap to wrap tools to allow users to define tags and classification of tools.

### Sinks
- http sink with bounded queue, retry and backoff
- console sink
- default configuration is HTTP sink to the primary handlebar api endpoint (https://api.gethandlebar.com), and api key access at HANDLEBAR_API_KEY env; although it can be configured with a different endpoint

### API
Centralised api manager which handles all interactions with Handlebar api, including the Http Sink. API flow is slightly different to current process:
- `PUT /v1/agents/{agent-slug}` — Upsert agent. Tools provided here atomically. Returns agent ID. (Tools can also be updated separately via `PUT /v1/agents/{agent_id}/tools` for dynamic tool registration post-init.)
- `PUT /v1/agents/{agent_id}/tools` - Register/update tools on agent.
- `POST /v1/runs/{run_id}/start` — Starts a run on the server. Replaced the separate preflight endpoint. Returns `{ lockdown: { active: boolean, reason?: string, until_ts: null | number } }`. Client calls this once before the first tool call. Lockdown mid-run is surfaced via the evaluate response instead.
- `POST /v1/runs/{run_id}/evaluate` — Send tool call context; server fetches active rules, evaluates, and returns a Decision. For `tool.after` phase, the request body also includes per-call metrics (bytes_in, bytes_out, records_out, duration_ms) so the server can update its rolling metric aggregates in real time — eliminating the need for a separate metrics poll. N.b. the `run_id` is the client-side generated run ID, not a server PK.
- `POST /v1/runs/{run_id}/events` — Run events / audit ingest (replaces old audit route). Events are batched by the HTTP sink.

#### Decision object
Returned from server
```ts
// On the action/tool use.
// HITL is NOT a verdict — it is expressed via cause.kind = "HITL_PENDING" combined with verdict = "BLOCK".
// REWRITE is removed for now (out of scope).
type Verdict = "ALLOW" | "BLOCK";

// On the agent process as a whole.
// PAUSE is not yet implemented — deferred. TERMINATE replaces EXIT_RUN_CODE.
type RunControl = "CONTINUE" | "TERMINATE";

type Cause =
  | { kind: "RULE_VIOLATION"; ruleId: string }
  | { kind: "HITL_PENDING"; approvalId: string; ruleId?: string }
  | { kind: "LOCKDOWN"; lockdownId?: string }
  | { kind: "ALLOW" } // no rule triggered

type RuleEval = {
  ruleId: string;
  enabled: boolean;
  matched: boolean;
  violated: boolean;
  // optional: which predicate matched, score, etc.
};

type Decision = {
  verdict: Verdict;
  control: RunControl;

  // Machine-readable why. Drives client-side behaviour (e.g. HITL_PENDING → different message to agent than RULE_VIOLATION).
  cause: Cause;

  // Human-readable explanation (for logging / developer debugging)
  message: string;

  // Audit trail. Required; may be sampled/truncated by server for performance.
  // matchedRuleIds / violatedRuleIds are REMOVED — derive from evaluatedRules client-side if needed.
  evaluatedRules: RuleEval[];

  // The single rule that produced the final verdict, if any.
  finalRuleId?: string;
};
```

The api manager and main core should handle an unresponsive api, with appropriate logic handling according to the failclosed config option.

## "Audit" events
Use the existing event schemas in `@handlebar/governance-schema` (packages/governance-schema). However, changes may need to be made (e.g. with new decision/verdict scope and new agent flow). in which case, made a proposal in this document.

## Integration with frameworks
The core design MUST be easy for users to wrap into their own agents, regardless of framework used (or none).
When planning the design, look up vercel ai v6, langchain js, and openai agents sdk for typescript. Map out how a user would integrate the Handlebar core pattern into their agents built with these frameworks, to identify potential DX or other bottlenecks.

---

## Review notes

### What's good

- **Client/Run separation** is the most important DX fix. The current `GovernanceEngine.createRunContext` pattern is awkward — runs feel like an afterthought. Making `Run` a first-class object with its own lifecycle is correct.
- **Server-side rule evaluation** simplifies the client drastically. The client no longer needs to carry rule schemas or evaluation logic; it's reduced to an HTTP call + decision dispatch. This also enables the server to evolve evaluation logic without client upgrades.
- **Richer `Decision` type** — `Verdict` + `RunControl` as separate axes is the right model. Currently `GovernanceDecision` conflates "what happened to this tool call" with "what should the agent do next." Separating them explicitly is cleaner.
- **Sinks in core** — currently `@handlebar/ai-sdk-v5` emits audit events, which means users of other frameworks get no telemetry. Moving all sink emission into core is the right move.
- **ALS for concurrent safety** — the current engine stores `this.metrics` (per-call state) as an instance property, which is a live concurrency bug for concurrent tool calls. The new per-`Run` state model fixes this correctly.
- **Explicit failopen/failclosed** — currently the engine silently continues on API errors with no configurable behavior. Making this explicit at init time is a real improvement.

---

## Open questions

### Q1: `REWRITE` verdict semantics
The `Verdict` type includes `"REWRITE"` but it's not defined anywhere. What does it mean?
- Does the server modify tool arguments and return the rewritten version?
- If so, the `Decision` response needs a `rewritten_args?: unknown` field and the `beforeTool` hook needs to return those args to the caller so the framework can use them instead of the original.
- If `REWRITE` is out of scope for now, remove it from the type and add it back when designed.

**Proposal:** Either spec it fully (with a `rewrittenArgs` field in Decision) or remove it for now.
**Answer:** out of scope for now. Remove and we can add it later.

### Q2: Local decision cache
The low-overhead requirements mention a "local decision cache." What can safely be cached?
- Many conditions are **stateful**: `maxCalls`, `sequence`, `executionTime` — caching decisions for these across steps is incorrect.
- Stateless conditions (e.g., `enduserTag`, `timeGate`, `toolName` matches) could potentially be cached per-run.
- The safest approach: no local cache for now, with the server expected to be fast. A TTL-based "bypass" cache keyed on `(agentId, toolName)` for pure allow decisions could be a future optimization.

**Proposal:** Defer local caching. Document that the server evaluate endpoint should respond in <50ms. Design the cache API as a future hook point.
**Answer:** Agree: defer local cachine.

### Q3: `RunControl.PAUSE` semantics
`"PAUSE"` is listed as a `RunControl` value but its behavior is undefined.
- How does a paused run resume? Polling? Webhook? SSE?
- Is PAUSE the new HITL mechanism (replacing the current `HANDLEBAR_EXIT_RUN_CODE` signal injected into tool output)?
- The current HITL flow terminates the run (EXIT_RUN_CODE → agent loop stops). PAUSE would imply the agent is suspended and can resume — a fundamentally different architecture.

**Proposal:** Map `PAUSE` to HITL. Define the resume mechanism explicitly (likely: client polls the evaluate endpoint with the same `run_id` until it gets `CONTINUE`). `TERMINATE` replaces the current EXIT_RUN_CODE pattern.
**Answer:** Review requests will be updated to either terminate (long-form approvals) or pause (short term expected responses, with a timeout). I don't think HITL should be a verdict as this is the same as BLOCK (i.e. tool is blocked regardless of pause/terminate). However, PAUSE is not an implemented feature right now, so can be ignored. TERMINATE replaces EXIT_RUN_CODE pattern.

### Q4: Preflight — separate loop or merged into run start?
Currently the design has two endpoints that check agent health:
1. `POST /v1/agents/{agent_id}/preflight` — lockdown + budget
2. `POST /v1/runs/{run_id}/evaluate` — per-call decision (which may also need to reflect lockdown)

**Issue:** If lockdown can happen mid-run, `evaluate` must also return lockdown state, making `preflight` redundant as a runtime check. Preflight would then only be useful as an eager check before the run starts.

**Proposal:** Merge preflight into `POST /v1/runs/{run_id}/start` (a new endpoint to emit `run.started` to the server). Preflight becomes a response field, not a separate polling loop. The client calls it once before the first tool call, not on a recurring basis.
**Answer**: I agree with the proposal.

### Q5: `actor` vs `enduser` naming
The design uses `actor?: Actor` in `Run` config but the existing schema package uses `EndUserConfig`.

**Proposal:** Introduce `actor` as the primary term in the new core interface (broader — an actor could be a human, system, or other agent). Keep `EndUserConfig` in the governance-schema package for backward compat, but map it transparently. Update the design and types to use `actor` consistently and note the mapping.
**Answer:** I agree with the proposal: use `actor` going forward, but keep existing `EndUserConfig` typing.

### Q6: `beforeLlm`/`afterLlm` return types
The design mentions these hooks as a "surface for PII redaction." For redaction to work, `beforeLlm` must be able to **return** modified messages, not just observe them. Otherwise the hook is useless for redaction.

**Proposal:** Define `beforeLlm(messages: LLMMessage[]): Promise<LLMMessage[]>` — the hook returns (potentially modified) messages. The caller is responsible for using the returned value. `afterLlm` can remain observe-only for now. Document that the redaction implementation is future work but the hook signature should support it from day one.
**Answer:** I agree with the proposal. The purpose for `beforeLlm` is to estimate tokens (which the server then estimates cost from) for tracking metrics. _in the near future_ to redact/alter llm messages and run some checks (e.g. a rule blocking llm calls if there is sensitive information in the message, rather than just redacting). So beforeLlm should return messages for when we implement that functionality. This LLMMessage should be provider agnositic and agent framework agnostic. Should the model information be part of LLMMessage?
afterLlm, similarly, collects token usage metrics from the LLm response and optionally will (in near future) alter the response going back into the framework. Some providers/frameworks may provide token estimates from the call, as well as execution time. If provided, these should be canonical over our client's estimations.

**Resolution on signatures:**
Model info should NOT be embedded in `LLMMessage` — a message is a message, model is call-level metadata. Pass it as a separate parameter:

```ts
// Provider-agnostic message shape (role + content only)
type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | LLMMessagePart[];
};

type LLMMessagePart = { type: "text"; text: string } | { type: "tool_use"; ... } | { type: "tool_result"; ... };

type ModelInfo = { name: string; provider?: string };

// Usage from the provider (canonical if present; client estimates if absent)
type TokenUsage = { inputTokens?: number; outputTokens?: number };

// beforeLlm: returns (possibly modified) messages. Model info provided for token estimation.
beforeLlm(messages: LLMMessage[], meta: { model?: ModelInfo }): Promise<LLMMessage[]>

// afterLlm: returns (possibly modified) response. Provider usage is canonical over client estimates.
afterLlm(response: LLMResponse, meta: { model?: ModelInfo; usage?: TokenUsage; durationMs?: number }): Promise<LLMResponse>

// LLMResponse is a provider-agnostic output shape (TBD — at minimum: text content + tool calls)
```

`LLMResponse` is fully normalised (no provider-specific fields):

```ts
type LLMResponsePart =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "refusal"; refusal: string };

type LLMResponse = {
  // Required. Canonical structured output.
  content: LLMResponsePart[];

  // Convenience: concatenated text from all text-type parts.
  // If not provided by the caller, the core auto-derives it from `content`.
  // If `afterLlm` modifies `content`, the core re-derives `outputText` from the result.
  // If only a flat string is available (e.g. simple provider wrapper), set this and leave `content` empty.
  outputText?: string;

  // Required. Model that produced the response.
  model: { name: string; provider?: string };

  // Provider-reported token counts. Canonical over client-side estimates when present.
  usage?: { inputTokens?: number; outputTokens?: number };

  // Wall-clock duration of the LLM call. Canonical over client-side estimates when present.
  durationMs?: number;
};

// Hook signatures (on Run):
// beforeLlm: returns possibly-modified messages. Model provided for token estimation.
beforeLlm(messages: LLMMessage[], meta: { model?: ModelInfo }): Promise<LLMMessage[]>

// afterLlm: returns possibly-modified response. Core re-derives outputText from content after return.
afterLlm(response: LLMResponse): Promise<LLMResponse>
```

**`outputText` convention:** `content` is the canonical representation. `outputText` exists for convenience and for integrations where only a flat string is available. The core always re-derives `outputText` from text parts in `content` after `afterLlm` returns, so callers only need to modify `content`.

### Q7: `Run.end(status?)` type
`status` is undefined. Should be:
```ts
type RunEndStatus = "success" | "error" | "timeout" | "interrupted";
```

**Answer:** I agree.

### Q8: `evaluatedRules` vs top-level `matchedRuleIds`/`violatedRuleIds`
The design itself asks this question. The answer is: they're redundant if `evaluatedRules` is present.

**Proposal:** Make `evaluatedRules` required (the server always returns it, but it may be sampled/truncated for performance). Remove the separate `matchedRuleIds` and `violatedRuleIds` top-level fields from `Decision`. Derive them from `evaluatedRules` client-side if needed for convenience.
**Answer:** I agree with the proposal.

---

## Additional design notes

### HTTP sink queue spec
The design says "bounded queue, retry and backoff" but needs specifics:
- **Queue depth:** 500 events max (configurable). On overflow: drop oldest.
- **Retry:** max 3 attempts, exponential backoff starting at 500ms, cap at 10s.
- **Flush on shutdown:** drain queue before process exit, with a configurable timeout (default 5s).
- **Batching:** batch up to 50 events per HTTP request to the events endpoint, flushed on a 1s interval or on queue reaching a high-water mark.

### Tool registration timing
The split `PUT /agents/{slug}` (init) + `PUT /agents/{agent_id}/tools` (register tools) creates a window where the server knows about the agent but not its tools. Tool-specific rules cannot be evaluated in this window.

**Proposal:** `HandlebarClient.init()` should accept tools as an optional parameter at init time and register them atomically. If tools are added dynamically (e.g., user-defined at runtime), provide a `client.registerTools(tools)` method that can be called before `startRun`. The run should not start until tool registration is complete.
**Answer:** agree.

### Redundancy between `cause` and `evaluatedRules`
`cause` is the human-readable summary of why the decision was made; `evaluatedRules` is the machine-readable audit trail. These serve different purposes and should both be kept. `cause.kind` drives client-side behavior (e.g., HITL_PENDING triggers a different flow than RULE_VIOLATION). `evaluatedRules` is for the audit log only.

### `runId` as client-generated ID
The design notes `run_id` is client-generated. The server should scope uniqueness to `(apiKey, agentId, runId)` — not globally. This avoids UUID collisions across different tenants and makes the contract explicit.

### Metrics polling removal
The current `POST /v1/agents/:id/metrics` polling loop can be removed if `metricWindow` conditions are now evaluated server-side (as part of the `/evaluate` endpoint). This is a simplification win — confirm with the backend team that `/evaluate` will handle metric budget checks.

**Clarification on current flow:** The current system has two layers:
1. The client tracks local metric usage (decrementing a budget grant counter per tool call via `BudgetManager`)
2. When the local grant hits 0 or TTL expires, it polls the server to get a refreshed budget from `POST /v1/agents/:id/metrics/budget`
3. Separately, the server extracts metrics from audit events to update its global metrics table

**The problem with audit-event-based server state in the new design:** The new sink will batch events (up to 1s interval). So when `/evaluate` is called for the next tool, the server may not yet have processed the previous step's audit event — meaning its metric aggregates are stale. This makes `metricWindow` conditions unreliable if the server relies on audit events.

**Resolution:** Include per-call metrics inline in the `POST /v1/runs/{run_id}/evaluate` request body for the `tool.after` phase. Concretely:

```ts
// tool.after evaluate request body includes:
{
  phase: "tool.after",
  tool: { name, args, result },
  metrics: {
    bytes_in?: number,
    bytes_out?: number,
    records_out?: number,
    duration_ms?: number,
    // custom metrics...
  }
}
```

The server uses these inline metrics to update its rolling window aggregates in real time as evaluate calls arrive, and evaluates `metricWindow` conditions against the up-to-date state. This means:
- `POST /v1/agents/:id/metrics` polling endpoint is **removed**
- `BudgetManager` local decrement logic is **removed** — server is authoritative
- The server's `/evaluate` response is the single source of truth for metric budget decisions
- Audit events are still emitted for observability, but are NOT used as the primary metric aggregation source

### `incStep()` from ALS — this is a problem
The current code calls `incStep()` from `audit/context.ts` which mutates a global ALS store. In the new design, step index must live on the `Run` object and be incremented there. The ALS store (if used) should read from the run, not hold its own mutable state.

### Implementation notes (updated as built)

**Event ingest split from ApiManager:** `POST /v1/runs/{run_id}/events` is handled entirely by the `HttpSink` (bounded queue, batching, retry) rather than the `ApiManager`. The `ApiManager` only handles control-plane calls (evaluate, start, upsert). This is a cleaner separation of concerns — the sink doesn't need to know about the agent/run domain, and the API manager doesn't need to know about batching.

**`beforeLlm` and `message.raw.created`:** Currently `beforeLlm` emits a single `message.raw.created` event with the full message list serialised to JSON. When proper per-message events are needed, this will need to iterate the messages array and emit one event per message. Deferred until the message schema is updated.

**Inline metrics in `afterTool`:** Per-call metrics (`bytes_in`, `bytes_out`, `duration_ms`) are computed locally in the `Run` and sent inline in the `/evaluate` request body for `tool.after`. The server uses these to update rolling metric aggregates in real time. The `BudgetManager` client-side tracking from the old core is not replicated.

**`enforceMode: "off"` skips the evaluate HTTP call entirely** — the `Run` short-circuits before calling the API. This is the lowest-overhead mode for development.

**ALS is opt-in for framework wrappers.** The primary API is explicit `run.beforeTool(...)` etc. `withRun`/`getCurrentRun` are only needed when a framework callback doesn't have access to the `run` object (e.g., middleware interceptors).

### Framework integration research needed
The design calls for mapping Handlebar's lifecycle to Vercel AI v6, LangChain JS, and OpenAI Agents SDK before finalizing the hook API. Key questions:
- **Vercel AI v6:** Does `onStepFinish` provide enough context for `afterTool`? Can `experimental_transform` be used for `beforeLlm` PII redaction?
- **LangChain JS:** Callbacks (`handleToolStart`, `handleToolEnd`, `handleLLMStart`, `handleLLMEnd`) map directly to Handlebar's lifecycle hooks. This is the easiest integration.
- **OpenAI Agents SDK:** The `on_tool_start`/`on_tool_end` hooks in the Python SDK have TypeScript equivalents that need verification.
