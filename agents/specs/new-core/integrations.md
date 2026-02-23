# Integrating Agent Frameworks with `@handlebar/core`

This document describes the lifecycle hooks and event flow for building framework adapters on top of the new core (`packages/core/src/new_core/`). The ai-sdk-v5 adapter (`packages/ai-sdk-v5`) is the reference implementation.

---

## Architecture overview

```
Handlebar.init(config)          → HandlebarClient   (one per agent process)
  └─ initSinks()                → HttpSink → POST /v1/runs/events (batched, retried)
  └─ initAgent()                → POST /v1/agents (upsert), stores agentId

client.startRun(RunConfig)      → Run               (one per request / conversation turn)
  └─ api.startRun()             → POST /v1/runs/{id}/start
  └─ new Run() constructor      ─→ emits  run.started

withRun(run, fn)                → binds Run in AsyncLocalStorage
getCurrentRun()                 → retrieves Run from anywhere inside tool/hook callbacks

run.beforeLlm(messages[])       ─→ emits  message.raw.created  (one per message, role → kind mapped)
                                    returns (possibly modified) messages — surface for PII redaction

run.beforeTool(name, args)      ─→ emits  tool.decision
                                    returns Decision { verdict: "ALLOW" | "BLOCK", control, ... }

run.afterTool(name, args, res)  ─→ emits  tool.result
                                    increments stepIndex

run.afterLlm(LLMResponse)       ─→ emits  llm.result
                                    emits  message.raw.created  (assistant response, kind = "output")

run.end(status)                 ─→ emits  run.ended
  └─ api.endRun()               → POST /v1/runs/{id}/end
  └─ bus.drain()                   flushes all queued events before returning
```

---

## Key types

```ts
// Passed to startRun()
type RunConfig = {
  runId: string;         // uuidv7() recommended
  model: ModelInfo;      // { name: string; provider?: string }
  actor?: Actor;         // { externalId: string; metadata?: Record<string, string> }
  sessionId?: string;    // groups multiple runs (multi-turn conversation)
  tags?: Record<string, string>;
  runTtlMs?: number;     // auto-end the run after this many ms
};

// Passed to afterLlm()
type LLMResponse = {
  content: LLMResponsePart[];   // { type: "text"; text: string } | { type: "tool_call"; ... }
  model: ModelInfo;
  usage?: { inputTokens?: number; outputTokens?: number };
  durationMs?: number;
  outputText?: string;          // derived automatically from content if omitted
};

// Returned by beforeTool()
type Decision = {
  verdict: "ALLOW" | "BLOCK";
  control?: "CONTINUE" | "TERMINATE";
  message?: string;
  evaluatedRules: Array<{ ruleId: string; matched: boolean }>;
  cause?: string;
  finalRuleId?: string;
};
```

---

## Minimal adapter pattern

```ts
import { Handlebar, withRun, getCurrentRun } from "@handlebar/core";
import { uuidv7 } from "uuidv7";

const hb = await Handlebar.init({ apiKey: "...", agent: { slug: "my-agent" } });

// --- Per-request ---

const run = await hb.startRun({
  runId: uuidv7(),
  model: { name: "gpt-4o", provider: "openai" },
  actor: { externalId: "user-123" },
});

await withRun(run, async () => {
  // Wrap tool execution
  async function wrappedTool(name: string, args: unknown, exec: () => Promise<unknown>) {
    const decision = await run.beforeTool(name, args);

    if (decision.verdict === "BLOCK") {
      // Return a blocked signal to the LLM; if control === "TERMINATE", stop the agent loop too
      return { blocked: true, reason: decision.message };
    }

    const start = Date.now();
    try {
      const result = await exec();
      await run.afterTool(name, args, result, Date.now() - start);
      return result;
    } catch (err) {
      await run.afterTool(name, args, undefined, Date.now() - start, err);
      throw err;
    }
  }

  // Before each LLM call — pass ONLY the new messages since the last call (delta, not full history)
  await run.beforeLlm(newMessages);

  // After each LLM step
  await run.afterLlm({
    content: [{ type: "text", text: "Hello!" }],
    model: { name: "gpt-4o", provider: "openai" },
    usage: { inputTokens: 100, outputTokens: 20 },
  });
});

await run.end("success"); // or "error" / "timeout"
```

---

## Lifecycle hooks in detail

### `run.beforeLlm(messages)`

- **When**: immediately before each LLM call, with the messages that will be sent.
- **Delta tracking**: the framework hook receives the full accumulated history each step; slice only the *new* messages (high-water mark) before calling `beforeLlm` to avoid duplicate `message.raw.created` events.
- **Emits**: one `message.raw.created` event per message. The `kind` field is mapped from role:
  - `user` → `"input"`, `assistant` → `"output"`, `tool` → `"tool_result"`, `system`/`developer` → `"observation"`
- **Returns**: the (possibly modified) messages — reserved for future PII redaction.

### `run.beforeTool(name, args, toolTags?)`

- **When**: before executing any tool call.
- **Emits**: `tool.decision` with verdict, matched rules, and cause.
- **Returns**: `Decision`. Adapter must check `verdict`:
  - `"ALLOW"` → proceed with execution.
  - `"BLOCK"` + `control === "TERMINATE"` → stop the agent loop entirely.
  - `"BLOCK"` + `control === "CONTINUE"` → skip this tool call; return a blocked message to the LLM.
- **`enforceMode`**: in `"shadow"` mode `beforeTool` still logs the decision but always returns ALLOW. In `"off"` mode it skips evaluation entirely.

### `run.afterTool(name, args, result, durationMs?, error?, toolTags?)`

- **When**: after a tool call completes (or throws). Call even on error.
- **Emits**: `tool.result` with outcome (`"success"` / `"error"`), duration, and error info.
- **Side effect**: increments `run.stepIndex`.

### `run.afterLlm(response)`

- **When**: after each LLM step, with the full response content and token usage.
- **Emits**: `llm.result` (tokens, model, message count) + `message.raw.created` for the assistant response.
- **Content fallback**: if `response.outputText` is empty (e.g. a tool-call-only step with no text), serialize `response.content` to JSON for the event payload.

### `run.end(status)`

- **When**: after the agent loop completes (or on error/timeout).
- **Status**: `"success"` | `"error"` | `"timeout"`.
- **Emits**: `run.ended`.
- **Important**: calls `bus.drain()` before returning — this guarantees all queued events (including `run.ended` itself) are flushed to the HTTP sink even if the process exits immediately after.

---

## Audit event kinds (reference)

| `kind`                  | Emitted by          | Notes                                      |
|-------------------------|---------------------|--------------------------------------------|
| `run.started`           | `new Run()`         | Actor, agentId, adapter name               |
| `message.raw.created`   | `beforeLlm`, `afterLlm` | One per message; `kind` maps from role |
| `tool.decision`         | `beforeTool`        | Verdict, matched rules, cause              |
| `tool.result`           | `afterTool`         | Outcome, duration, error                   |
| `llm.result`            | `afterLlm`          | Token usage, model, message count          |
| `run.ended`             | `run.end()`         | Status, total steps                        |

---

## HttpSink behaviour

- Events are queued in memory (max 500; oldest dropped under back-pressure).
- Flushed every 1 second via `setInterval` (unref'd — does not prevent process exit).
- `drain()` forces an immediate flush through the same serialiser, with a 5 s timeout. Called automatically by `run.end()`.
- Each `sendBatch` request carries an `x-handlebar-batch-id` header (UUID) for server-side idempotency on retry.
- Retry policy: up to 3 retries, exponential backoff starting at 500 ms, capped at 10 s. 4xx responses are not retried.
