Create unit tests for the main elements of `@handlebar/core` package (packages/core). Use the "bun:test" library and write tests in `packages/core/test/`. Mock interactions the code has with APIs. In the tests, capture a couple happy paths and a few failure cases:
- unexpected but possible inputs
- the code throws an error when expected
- the code returns nulls/undefined when expected

The objective in this testing is to capture the capabilities of `core` for regressions as it later undergoes a large refactor. In particular, we want to test:
- how the shared run context is updated and accessed
- how rule evaluations are handled at each stage of the lifecycle
- that lifecycle emits events as expected
- calculation of inbuilt metrics like token usage
- telemetry and sinks work as expected (primarily HTTP - console and file do not need to be tested)
- metric collection and resetting work as expected (packages/core/metrics/)
- Budgets are requested and evaluated (packages/core/budget-manager.ts)
- 

If you think you have identified a bug in logic while constructing the tests, make a note of it in this file and report it to the user; do NOT make a test for either the actual or expected behavior in this scenario.

## Plan

### Test file structure

New files go in `packages/core/test/`. Existing files (`tool.test.ts`, `tokens.test.ts`, `utils.test.ts`) are already in good shape and should be left largely untouched, though `engine.test.ts` is a placeholder that will be filled in.

```
packages/core/test/
├── engine.test.ts           # GovernanceEngine – lifecycle, decisions, run context
├── conditions.test.ts       # Each condition evaluator via engine.beforeTool
├── signals.test.ts          # SignalRegistry – bind, eval, caching, compare operators
├── subjects.test.ts         # SubjectRegistry – extraction, fail-closed behaviour
├── budget-manager.test.ts   # BudgetManager – TTL, usage decrement, reevaluate
├── api-manager.test.ts      # ApiManager – mocked fetch (init, rules, HITL, budgets)
├── telemetry-http.test.ts   # HTTP AuditSink – event POST, headers, fire-and-forget
├── metrics-aggregator.test.ts  # AgentMetricCollector – inbuilt & custom metrics
├── metrics-hooks.test.ts    # AgentMetricHookRegistry – phase dispatch, when guards
├── metrics-utils.test.ts    # approxBytes, approxRecords, validateMetricKey
├── time.test.ts             # nowToTimeParts, hhmmToMinutes, timezone handling
├── tool.test.ts             # (already complete)
├── tokens.test.ts           # (already complete)
└── utils.test.ts            # (mostly complete; add stableJson + getByDotPath)
```

---

### Mocking strategy

- **HTTP / fetch** – intercept `globalThis.fetch` with `mock.fn()` for all `ApiManager` and `HttpSink` tests. Never make real network calls. Restore the original in `afterEach`.
- **Telemetry bus** – pass a custom `AuditBus` stub (with `emit`, `use`, `shutdown` no-ops or spies) directly to `GovernanceEngine` via its `bus` constructor argument. This avoids touching the `Telemetry` singleton in almost all tests. For the few tests that exercise `Telemetry.init()` directly, reset the singleton's internal state in `afterEach`.
- **`telemetry-http.test.ts` teardown** – create a fresh `AuditBus` instance per test (not the singleton) and `await bus.shutdown()` in `afterEach` to flush pending fetch promises and prevent bleed-through to subsequent tests.
- **Time** – freeze `Date.now()` via `mock.fn()` on the global for `BudgetManager` TTL and `evalTimeGate` tests. Restore in `afterEach`.
- **Tiktoken** – the encoder is already imported; no mock needed, tests call through directly.
- **Env vars** – set `HANDLEBAR_API_KEY` and `HANDLEBAR_API_ENDPOINT` via `process.env` in `beforeEach`; delete them in `afterEach` to prevent cross-test pollution.

---

### engine.test.ts – GovernanceEngine

**Run context**
- `createRunContext` returns expected shape: runId, stepIndex=0, empty history/counters/state, correct enduser config
- `beforeTool` increments `stepIndex` on each call
- `beforeTool` appends to `history` (tool name + args + decision)
- `counters` accumulate per-tool call counts across multiple `beforeTool` calls
- `state` map is readable/writable across lifecycle calls within same context

**Decision lifecycle – happy paths**
- No rules → decision is `allow`
- Single `allow` rule matching tool → decision is `allow`
- Single `block` rule matching → decision is `block`, code is `BLOCKED_RULE`
- Single `hitl` rule matching → decision is `hitl`, code is `BLOCKED_HITL_REQUESTED`
- `block` + `hitl` on same tool → `block` wins (effectRank precedence)
- Rule selector scoped to `before` phase does not fire in `after` phase and vice versa
- Glob selector (`send_*`) matches `send_email`

**Decision lifecycle – failure / edge cases**
- Unknown tool name → `allow` (no matching rule)
- Rule with no matching conditions → falls through to default
- `beforeTool` called with args that are not plain objects (string, null, array)

**Audit event emission**
- `beforeTool` emits a `tool.decision` event via the bus
- `afterTool` emits a `tool.result` event with executionTimeMS
- `emitLLMResult` emits an `llm.result` event with token counts
- Events carry correct `runId`, `stepIndex`, `agentId`

---

### conditions.test.ts – Condition evaluators

Each condition tested by constructing a minimal `GovernanceEngine` with one rule whose condition is the type under test, then calling `beforeTool`.

**toolName** – eq, neq, contains, startsWith, endsWith, glob, in; case-sensitive
**toolTag** – has (present / absent), anyOf (partial match), allOf (all must match)
**toolArg** – dot-path read; string eq/contains/startsWith; number gt/lt/gte/lte; boolean eq; missing path → condition false
**enduserTag** – tag in enduser config matches / does not match
**maxCalls** – within limit (allow), at limit (block), counter resets on new context
**sequence** – glob pattern matches history tail; pattern with two steps; no match
**executionTime** – after-phase executionTimeMS gt threshold triggers; before-phase skipped
**timeGate** – window covering `now` allows; window not covering `now` blocks; timezone respected
**requireSubject** – registered extractor returns subject → passes; extractor returns [] → blocks; extractor throws → blocks (fail-closed)
**signal** – registered provider returns value, comparison eq passes; provider throws → condition false; caching: provider called only once per call even if referenced multiple times
**metricWindow** – `reevaluate()` false and grant remaining → allow; grant exhausted → block
**and / or / not** – short-circuit evaluation; nested combinations

---

### signals.test.ts – SignalRegistry

- `register` / `has` / `unregister` lifecycle
- `eval` calls provider with bound args and returns value
- `bind` resolves each binding type: `const`, `toolArg` dot-path, `enduserId`, `enduserTag`, `subject` (first match by type)
- Caching: same key+args on same call returns cached result, provider not called twice
- Provider that returns a Promise is awaited
- Provider that throws → `SignalResult` with error, condition evaluates to false
- `compareSignal` operators: eq, neq, gt, gte, lt, lte, in (value in array), nin
- `sanitiseSignals` truncates array to 100 items and string slices to 256 chars

---

### subjects.test.ts – SubjectRegistry

- `register` / `unregister` lifecycle
- `extract` calls registered extractor and returns subjects
- Extractor returns multiple subjects → all returned
- No extractor registered for tool → returns []
- Extractor throws → returns [] (fail-closed, does not rethrow)
- `sanitiseSubjects` truncates to 100 subjects and 256-char limits

---

### budget-manager.test.ts – BudgetManager

- `constructor` defaults: `reevaluate()` returns true on first call (no budgets loaded)
- `updateBudgets` sets grants and TTL; `reevaluate()` returns false immediately after update
- `reevaluate()` returns true after TTL expires (mock `Date.now`)
- `usage` decrements grant remaining for matching rule; other grants unaffected
- Grant exhausted (`grant <= 0`) → `reevaluate()` returns true immediately
- `updateBudgets` with empty array → `reevaluate()` returns false (no exhausted grants to force refresh)
- Multiple rules hitting same budget grant

---

### api-manager.test.ts – ApiManager (isolated, mocked fetch)

All calls mock `globalThis.fetch`.

**initialiseAgent**
- Happy path: PUT agent succeeds, GET rules returns rule array, POST budgets returns grants → budgets stored on BudgetManager
- PUT agent fails (non-2xx) → throws
- GET rules returns empty array → engine has no rules, no budget evaluation
- Budget POST fails → initialise still completes (rules usable, budgets empty)

**queryHitl**
- Returns `approved` status → engine emits hitl-resolved audit event
- Returns `pending` → returns pending decision
- Non-2xx response → throws

**evaluateMetrics**
- Serialises matched rules correctly in POST body
- Response parsed via `BudgetGrantResponse` zod schema; invalid response → throws

---

### api-budget-integration.test.ts – ApiManager ↔ BudgetManager end-to-end

Tests the full flow from agent initialisation through to budget exhaustion driving a `block` decision. `fetch` is still mocked.

- `initialiseAgent` populates real `BudgetManager` with grants; subsequent `reevaluate()` returns false (TTL not expired, no grants exhausted)
- After `BudgetManager.usage()` drains a grant to zero, `reevaluate()` returns true; engine calls `evaluateMetrics` again on next `beforeTool`; refreshed grants are applied
- Full `beforeTool` call with a `metricWindow` rule: grant has remaining → decision is `allow`; after usage drains grant and refresh returns zero remaining → decision is `block`
- `evaluateMetrics` returns a grant with `decision: "block"` (API-side override) → engine decision is `block` regardless of remaining grant value

---

### telemetry-http.test.ts – HTTP AuditSink

- `HttpSink.write` POSTs event JSON to the configured endpoint with correct headers
- Auth header is included when apiKey provided
- Response non-2xx is silently swallowed (fire-and-forget)
- `fetch` throws (network error) → silently swallowed
- `flush` resolves immediately (no-op for HTTP sink)

---

### metrics-aggregator.test.ts – AgentMetricCollector

- `setInbuilt` / `addInbuilt` for each inbuilt kind (bytes_in, bytes_out, records_out, duration_ms)
- `addInbuilt` accumulates across multiple calls
- `setCustom` stores value; `addCustom` accumulates
- `validateMetricKey` rejects keys with special chars, keys > 64 chars, empty string
- `setCustom` with invalid key throws
- `aggregate` moves per-call values into aggregation state and resets per-call
- `toEventPayload` serialises all metrics correctly; empty collector produces empty payload
- Setting same inbuilt metric twice (set then set) uses last value

---

### metrics-hooks.test.ts – AgentMetricHookRegistry

- `registerHook` validates required fields (key, phase, run); throws on missing
- `runPhase` calls hook `run` and passes metrics via `onMetric` callback
- Hook with `when` guard: guard false → hook not called
- Hook `timeoutMs` exceeded → hook result discarded (test with artificial delay)
- Non-blocking hook: slow hook does not delay `runPhase` resolution
- Blocking hook: `runPhase` awaits it
- `unregisterHook` removes hook; subsequent `runPhase` does not call it

---

### metrics-utils.test.ts – Metric utilities

- `approxBytes`: Buffer → byteLength; string → UTF-8 byte count; object → JSON byte count; null/undefined → 0
- `approxRecords`: Array → length; object with `.records` array → its length; object with `.count` number → that value; primitive → 0
- `validateMetricKey`: valid keys pass; empty, too-long, special-char keys return false

---

### time.test.ts – Time utilities

- `hhmmToMinutes("00:00")` → 0; `"23:59"` → 1439; `"09:30"` → 570
- `nowToTimeParts`: returns correct `hhmm` and `dow` for a known UTC epoch in UTC timezone
- `nowToTimeParts`: returns adjusted `hhmm` for a UTC epoch in a UTC+5:30 timezone
- Invalid timezone string → throws or returns a predictable fallback

---

### utils.test.ts additions (stableJson + getByDotPath)

- `stableJson`: object with unordered keys → always same output regardless of insertion order
- `stableJson`: circular reference → `"[Circular]"` in output
- `stableJson`: nested objects sorted recursively
- `getByDotPath`: shallow key; nested path; array index (`a.0.b`); missing key → undefined; non-object intermediate → undefined

---

### Bugs identified during planning

_(None identified yet. Will be updated during test implementation if issues surface.)_
