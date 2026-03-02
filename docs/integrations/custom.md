# Handlebar + Custom / Unsupported Frameworks

`@handlebar/core` is the framework-agnostic foundation that all Handlebar adapters build on. If your agent framework doesn't have a pre-built adapter, or you've built a custom agent loop, you can wire Handlebar in directly with a handful of function calls.

This guide covers the full integration — from initial setup through tool governance, LLM event logging, and per-user enforcement.

---

## Installation

```bash
npm install @handlebar/core
```

Set your API key (or pass it explicitly in config):

```bash
HANDLEBAR_API_KEY=hb_...
```

---

## The client — initialise once

`HandlebarClient` is a long-lived object that manages agent registration, rule fetching, and audit event delivery. Create it once at application startup, not per-request.

```ts
import { Handlebar } from "@handlebar/core";

const hb = await Handlebar.init({
  agent: {
    slug: "my-agent",         // unique identifier for this agent in the platform
    name: "My Agent",         // optional display name
    description: "…",         // optional
  },
});
```

`Handlebar.init` is async because it registers the agent with the Handlebar API and fetches its configured rules. Everything else waits on this internally — you can `await hb.ready()` if you need to be certain registration is complete before proceeding, but it is not normally required.

### Init options

| Field | Default | Description |
|---|---|---|
| `agent.slug` | required | Unique identifier for the agent. Used to scope rules on the platform. |
| `apiKey` | `HANDLEBAR_API_KEY` env | API key from the Handlebar platform. |
| `enforceMode` | `"enforce"` | `"enforce"` blocks/terminates on violations. `"shadow"` logs decisions but never blocks (useful during rollout). `"off"` skips rule evaluation entirely. |
| `failClosed` | `false` | If the Handlebar API is unreachable: `false` = allow all, `true` = block all. |
| `tools` | — | Tool descriptors known at init time — see [Tool metadata](#tool-metadata-tags). |

---

## Runs — one per agent invocation

A **run** represents a single agent invocation from start to finish. It carries the run ID, tracks tool call history and token usage, and emits audit events throughout its lifetime.

Create a run at the start of each request and end it when the agent finishes.

```ts
import { uuidv7 } from "uuidv7";

async function handleRequest(userMessage: string) {
  const run = await hb.startRun({
    runId: uuidv7(),   // a fresh ID for this invocation
  });

  try {
    const result = await myAgentLoop(run, userMessage);
    await run.end("success");
    return result;
  } catch (err) {
    await run.end("error");
    throw err;
  }
}
```

`run.end()` flushes all pending audit events before returning, so the process can exit cleanly immediately after.

### End statuses

| Status | When to use |
|---|---|
| `"success"` | Agent completed normally |
| `"error"` | Agent threw an unhandled error |
| `"interrupted"` | A `BLOCK + TERMINATE` governance decision ended the run early |
| `"timeout"` | Run exceeded its TTL (set `runTtlMs` on `startRun` for automatic timeout) |

---

## Lifecycle hooks

Lifecycle hooks are the calls you make on `run` as your agent progresses. They are the primary integration surface — each one corresponds to a phase of the agent loop.

### `run.beforeTool(name, args, tags?)` — before a tool executes

Call this immediately before invoking any tool. It evaluates the call against your configured rules and returns a `Decision`.

```ts
const decision = await run.beforeTool("send_email", { to, subject, body });

if (decision.verdict === "BLOCK") {
  if (decision.control === "TERMINATE") {
    // Hard stop — end the run and surface the error to the caller.
    await run.end("interrupted");
    throw new Error(decision.message);
  }
  // Soft block — skip the tool and return a message for the LLM to reason about.
  return { blocked: true, reason: decision.message };
}

// ALLOW — proceed with normal execution.
const result = await sendEmail(to, subject, body);
```

The `Decision` shape:

```ts
type Decision = {
  verdict: "ALLOW" | "BLOCK";
  control: "CONTINUE" | "TERMINATE";
  message: string;          // human-readable reason, safe to surface to the LLM
  evaluatedRules: RuleEval[];
};
```

**`BLOCK + CONTINUE`** means the tool should be skipped but the agent loop can continue — the blocked message is typically returned to the LLM so it can respond gracefully.

**`BLOCK + TERMINATE`** means the run should stop entirely. Throw an error that propagates up through your agent loop, catch it at the top level, and call `run.end("interrupted")`.

### `run.afterTool(name, args, result, durationMs?, error?, tags?)` — after a tool returns

Call this after every tool invocation, regardless of success or failure. It logs the result and evaluates any `tool.after` rules (e.g. inspecting output content or checking data exfiltration patterns).

```ts
const start = Date.now();
try {
  const result = await executeTool(name, args);
  await run.afterTool(name, args, result, Date.now() - start, undefined, tags);
  return result;
} catch (err) {
  await run.afterTool(name, args, undefined, Date.now() - start, err, tags);
  throw err;
}
```

`afterTool` also returns a `Decision` (evaluated at the `tool.after` phase). Most integrations do not need to act on it, but you can check `decision.verdict` if you want to apply post-execution governance.

### `run.beforeLlm(messages)` — before an LLM call

Call this before each call to the language model, passing the messages being sent. It emits `message.raw.created` audit events for each message, enabling full conversation logging on the platform.

```ts
// messages is LLMMessage[] — role + content
const messages = await run.beforeLlm([
  { role: "system", content: systemPrompt },
  { role: "user", content: userMessage },
]);
// Use the returned messages array — it may be modified in future for PII redaction etc.
await llm.complete(messages);
```

`beforeLlm` is optional — skipping it means conversation content won't appear in audit logs, but tool governance still works fully.

### `run.afterLlm(response)` — after an LLM call

Call this after the LLM responds. It logs the response content, records token usage for cost tracking, and emits an `llm.result` event.

```ts
const llmResponse = await llm.complete(messages);

await run.afterLlm({
  model: { name: "gpt-4o", provider: "openai" },
  content: [
    { type: "text", text: llmResponse.text },
    // tool calls, if any:
    { type: "tool_call", toolCallId: "tc_1", toolName: "search", args: { query: "…" } },
  ],
  usage: {
    inputTokens: llmResponse.usage.prompt_tokens,
    outputTokens: llmResponse.usage.completion_tokens,
  },
});
```

Like `beforeLlm`, this is optional but enables token-based budget enforcement and spend tracking on the platform.

---

## Wiring it all together — a minimal agent loop

```ts
import { Handlebar, withRun } from "@handlebar/core";
import { uuidv7 } from "uuidv7";

const hb = await Handlebar.init({ agent: { slug: "my-agent" } });

async function runAgent(userMessage: string) {
  const run = await hb.startRun({ runId: uuidv7() });

  try {
    let messages = [{ role: "user", content: userMessage }];

    while (true) {
      await run.beforeLlm(messages);
      const response = await llm.complete(messages);
      await run.afterLlm({ model: { name: "gpt-4o" }, content: response.content, usage: response.usage });

      if (!response.toolCalls?.length) {
        // No more tool calls — agent is done.
        await run.end("success");
        return response.text;
      }

      // Execute each tool call.
      for (const tc of response.toolCalls) {
        const decision = await run.beforeTool(tc.name, tc.args);

        let toolResult: unknown;
        if (decision.verdict === "BLOCK") {
          if (decision.control === "TERMINATE") {
            await run.end("interrupted");
            throw new Error(decision.message);
          }
          toolResult = { blocked: true, reason: decision.message };
        } else {
          const start = Date.now();
          try {
            toolResult = await executeTool(tc.name, tc.args);
            await run.afterTool(tc.name, tc.args, toolResult, Date.now() - start);
          } catch (err) {
            await run.afterTool(tc.name, tc.args, undefined, Date.now() - start, err);
            throw err;
          }
        }

        messages.push({ role: "tool", content: JSON.stringify(toolResult), toolCallId: tc.id });
      }

      messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });
    }
  } catch (err) {
    await run.end("error");
    throw err;
  }
}
```

### Passing the run through async contexts

If your tool implementations live in separate modules and can't receive `run` as a parameter, use `withRun` to bind the run to the current async context. Any code running inside the callback can then retrieve it with `getCurrentRun()`.

```ts
// Top-level: bind the run
await withRun(run, async () => {
  await myAgentLoop(userMessage);
});

// Deep inside a tool implementation:
import { getCurrentRun } from "@handlebar/core";

async function myToolImpl(args) {
  const run = getCurrentRun(); // retrieves the run from the async context
  if (run) {
    const decision = await run.beforeTool("my_tool", args);
    // ...
  }
}
```

This is how the pre-built adapters (`@handlebar/langchain`, `@handlebar/ai-sdk-v5`) work internally — they bind the run in `withRun` at the executor level, so tool wrappers don't need an explicit reference.

---

## Tool metadata — tags

Tool **tags** are string labels that describe a tool's nature or capability class. You attach them to tools at registration time and pass them through on every `beforeTool` / `afterTool` call.

Tags are what allow you to write rules that apply to *groups of tools* rather than individual ones — for example: "block any `external-write` tool after 11pm", or "require human review for any `pii-access` tool when the user is on the free tier".

### Registering tools with tags

Declare tools and their tags at init time so the Handlebar platform knows about them:

```ts
const hb = await Handlebar.init({
  agent: { slug: "my-agent" },
  tools: [
    { name: "search_web",    tags: ["read-only", "external"] },
    { name: "read_file",     tags: ["read-only", "filesystem"] },
    { name: "write_file",    tags: ["write", "filesystem"] },
    { name: "send_email",    tags: ["write", "external", "comms"] },
    { name: "query_db",      tags: ["read-only", "pii-access"] },
  ],
});
```

For tools added dynamically after init:

```ts
await hb.registerTools([
  { name: "new_tool", tags: ["write", "external"] },
]);
```

### Passing tags on each call

Pass the same tags to `beforeTool` and `afterTool` so the rule engine has full context at evaluation time:

```ts
const TOOL_TAGS: Record<string, string[]> = {
  send_email: ["write", "external", "comms"],
  search_web: ["read-only", "external"],
};

const tags = TOOL_TAGS[toolName] ?? [];
const decision = await run.beforeTool(toolName, args, tags);
// ...
await run.afterTool(toolName, args, result, durationMs, undefined, tags);
```

Tags registered at init and tags passed at call time are both used by the rule engine. Registering at init gives the platform a full picture of your agent's tool inventory; passing at call time ensures correctness if tools are added dynamically or tags change at runtime.

---

## Actor — per-user enforcement

The **actor** is the end user or system identity the agent is acting on behalf of during a run. Providing it enables Handlebar to enforce per-user rules — for example: rate limiting a single user's tool usage, applying stricter data controls to users tagged `"region:eu"`, or capping spend per user tier.

Pass the actor when starting the run:

```ts
const run = await hb.startRun({
  runId: uuidv7(),
  actor: {
    externalId: "usr_123",   // your system's ID for this user — the only required field
  },
});
```

### Full actor schema

```ts
actor?: {
  externalId: string;        // your ID for the user
  name?: string;             // display name (shown in platform logs)
  metadata?: Record<string, string>;  // arbitrary key/value labels for rule matching
  group?: {
    externalId: string;      // your ID for the group this user belongs to
    name?: string;
    metadata?: Record<string, string>;
  };
}
```

### Using metadata for group-based rules

Metadata is where per-user and per-group rule conditions come from. For example, attaching `{ tier: "free", region: "eu" }` lets you write rules like "block `pii-access` tools for free-tier users" or "require human review for any write tool when `region` is `eu`".

```ts
const run = await hb.startRun({
  runId: uuidv7(),
  actor: {
    externalId: req.userId,
    metadata: {
      tier: user.plan,          // "free" | "pro" | "enterprise"
      region: user.region,      // "eu" | "us" | ...
    },
    group: {
      externalId: user.orgId,
      metadata: {
        plan: org.plan,
      },
    },
  },
});
```

The platform registers actor metadata the first time it is provided. You don't need to send it on every run — only when it changes.

---

## Sessions

Group multiple runs under a single session to get end-to-end analytics across a multi-turn conversation:

```ts
const sessionId = uuidv7(); // generated once at conversation start, reused across turns

// Turn 1
const run1 = await hb.startRun({ runId: uuidv7(), sessionId });
// ...
await run1.end("success");

// Turn 2
const run2 = await hb.startRun({ runId: uuidv7(), sessionId });
// ...
await run2.end("success");
```

---

## Shutdown

Flush pending audit events before the process exits:

```ts
process.on("SIGTERM", async () => {
  await hb.shutdown();
  process.exit(0);
});
```
