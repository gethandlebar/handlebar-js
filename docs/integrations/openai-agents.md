# Handlebar + OpenAI Agents SDK (TypeScript)

The OpenAI Agents SDK (`@openai/agents`) provides both an event-based hook system (`AgentHooks` / `RunHooks`) and a tool-wrapping approach. Handlebar supports both, but **tool wrapping is required** to enforce BLOCK decisions.

> **Note:** No pre-built adapter package exists yet for the OpenAI Agents SDK. The patterns below show how to wire Handlebar directly.

---

## Architecture

| Handlebar hook | OpenAI Agents SDK equivalent | Notes |
|---|---|---|
| `run.beforeTool(name, args, tags)` | Tool `execute` wrapper | Hooks are observational; wrapping is needed to block |
| `run.afterTool(name, args, result, ms)` | Tool `execute` wrapper (after exec) | |
| `run.beforeLlm(messages)` | Not directly available | Emit manually before `run()` |
| `run.afterLlm(response)` | `RunHooks` `agent_end` or `AgentHooks` | Token usage not exposed in hooks; use tracing if needed |
| `run.end(status)` | After `run()` resolves/rejects | |

---

## Option A — Tool wrapping (recommended, full governance)

Wrap each tool's `execute` function to inject governance before and after invocation.

```ts
import { Agent, tool, run as runAgent, type RunHooks } from "@openai/agents";
import { Handlebar, withRun, getCurrentRun, type Run } from "@handlebar/core";
import { uuidv7 } from "uuidv7";
import { z } from "zod";

// 1. Init client once.
const hb = await Handlebar.init({
  apiKey: process.env.HANDLEBAR_API_KEY,
  agent: { slug: "my-agent" },
});

// 2. Helper: wrap a tool's execute function with Handlebar governance.
function wrapTool<TParams extends Record<string, unknown>, TResult>(
  toolDef: ReturnType<typeof tool<TParams, TResult>>,
  tags: string[] = [],
): ReturnType<typeof tool<TParams, TResult>> {
  const originalExecute = toolDef.execute;

  return {
    ...toolDef,
    execute: async (params: TParams, context) => {
      const run = getCurrentRun();
      if (!run) {
        // No run bound — governance skipped (should not happen in normal flow).
        return originalExecute(params, context);
      }

      // --- before tool ---
      const decision = await run.beforeTool(toolDef.name, params, tags);

      if (decision.verdict === "BLOCK") {
        if (decision.control === "TERMINATE") {
          // Throw to propagate termination up to the agent loop caller.
          throw new Error(`HANDLEBAR_TERMINATE: ${decision.message}`);
        }
        return { blocked: true, reason: decision.message } as unknown as TResult;
      }

      // --- execute ---
      const start = Date.now();
      try {
        const result = await originalExecute(params, context);
        await run.afterTool(toolDef.name, params, result, Date.now() - start, undefined, tags);
        return result;
      } catch (e) {
        await run.afterTool(toolDef.name, params, undefined, Date.now() - start, e, tags);
        throw e;
      }
    },
  };
}

// 3. Define tools.
const searchTool = tool({
  name: "search",
  description: "Search the web for information",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => fetchSearchResults(query),
});

const emailTool = tool({
  name: "send_email",
  description: "Send an email",
  parameters: z.object({ to: z.string(), body: z.string() }),
  execute: async ({ to, body }) => sendEmail(to, body),
});

// 4. Build agent with wrapped tools.
const agent = new Agent({
  name: "my-agent",
  model: "gpt-4o",
  tools: [
    wrapTool(searchTool, ["read-only"]),
    wrapTool(emailTool, ["write", "external"]),
  ],
});

// 5. Per-request: start a Run, bind it in ALS, execute the agent.
async function handleRequest(input: string, actorId: string) {
  const run = await hb.startRun({
    runId: uuidv7(),
    actor: { externalId: actorId },
  });

  // Emit input observation.
  await run.beforeLlm([{ role: "user", content: input }]);

  try {
    const result = await withRun(run, () =>
      runAgent(agent, input),
    );
    await run.end("success");
    return result.finalOutput;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    await run.end(msg.startsWith("HANDLEBAR_TERMINATE:") ? "interrupted" : "error");
    throw e;
  }
}
```

---

## Option B — `RunHooks` for observability

`RunHooks` fires events around the agent lifecycle. Use this for audit logging in `shadow` or `off` mode where governance is not enforced, or to supplement tool wrapping with additional observability.

```ts
import { RunHooks } from "@openai/agents";
import type { Run } from "@handlebar/core";

function createHandlebarRunHooks(run: Run): RunHooks {
  const hooks = new RunHooks();
  const startTimes = new Map<string, number>();

  // agent_tool_start fires before the tool's execute function is called.
  hooks.on("agent_tool_start", async (context, agent, tool, toolCall) => {
    startTimes.set(toolCall.callId, Date.now());
    // Observe only — governance enforcement requires tool wrapping (Option A).
    await run.beforeTool(tool.name, toolCall.input ?? {});
  });

  // agent_tool_end fires after the tool's execute function returns.
  hooks.on("agent_tool_end", async (context, agent, tool, result, toolCall) => {
    const durationMs = Date.now() - (startTimes.get(toolCall.callId) ?? Date.now());
    startTimes.delete(toolCall.callId);
    await run.afterTool(tool.name, toolCall.input ?? {}, result, durationMs);
  });

  return hooks;
}

// Usage:
const run = await hb.startRun({ runId: uuidv7() });
const hooks = createHandlebarRunHooks(run);

const result = await runAgent(agent, "Search for AI news", { hooks });
await run.end("success");
```

### Available `RunHooks` events

| Event | Parameters | Handlebar mapping |
|---|---|---|
| `agent_start` | `(context, agent, inputItems?)` | — |
| `agent_end` | `(context, agent, output)` | Can call `run.end()` |
| `agent_tool_start` | `(context, agent, tool, toolCall)` | `run.beforeTool()` |
| `agent_tool_end` | `(context, agent, tool, result, toolCall)` | `run.afterTool()` |
| `agent_handoff` | `(context, fromAgent, toAgent)` | — |

---

## Combining both approaches

For full governance with observability, combine tool wrapping (for BLOCK enforcement) with `RunHooks` (for additional tracing):

```ts
const run = await hb.startRun({ runId: uuidv7() });

const agentWithWrappedTools = new Agent({
  name: "my-agent",
  model: "gpt-4o",
  tools: [wrapTool(searchTool, ["read-only"])],
});

const hooks = createHandlebarRunHooks(run);

await withRun(run, () => runAgent(agentWithWrappedTools, input, { hooks }));
await run.end("success");
```

---

## Shutdown

```ts
process.on("SIGTERM", async () => {
  await hb.shutdown();
  process.exit(0);
});
```
