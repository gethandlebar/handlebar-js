# Handlebar + Vercel AI SDK

The `@handlebar/ai-sdk-v5` package provides a first-class adapter for the Vercel AI SDK. This guide covers both the recommended wrapper approach and manual integration for teams that need more control.

---

## Option A — `HandlebarAgent` (recommended)

`HandlebarAgent` is a drop-in wrapper around the AI SDK's `Experimental_Agent`. It wires up all lifecycle hooks automatically.

```ts
import { Handlebar } from "@handlebar/core";
import { HandlebarAgent } from "@handlebar/ai-sdk-v5";
import { openai } from "@ai-sdk/openai";
import { tool } from "ai";
import { z } from "zod";

// 1. Init the client once (e.g. at server start).
const hb = await Handlebar.init({
  apiKey: process.env.HANDLEBAR_API_KEY,
  agent: { slug: "my-agent", name: "My Agent" },
  tools: [
    { name: "search", tags: ["read-only"] },
    { name: "send_email", tags: ["write", "external"] },
  ],
});

// 2. Define tools as normal AI SDK tools.
const tools = {
  search: tool({
    description: "Search the web",
    parameters: z.object({ query: z.string() }),
    execute: async ({ query }) => fetchSearchResults(query),
  }),
  send_email: tool({
    description: "Send an email",
    parameters: z.object({ to: z.string(), body: z.string() }),
    execute: async ({ to, body }) => sendEmail(to, body),
  }),
};

// 3. Create the agent — pass `hb` to enable new-core governance.
const agent = new HandlebarAgent({
  model: openai("gpt-4o"),
  tools,
  hb,
  // Optional: Per-tool tags for governance rule matching
  toolTags: {
    search: ["read-only"],
    send_email: ["write", "external"],
  },
  // Optional: per-run defaults applied to every hb.startRun() call.
  runDefaults: {
    actor: { externalId: "user-123" },
  },
});

// 4. Run — each call starts a fresh Run internally.
const result = await agent.generate("Find recent AI news and summarise it.");
```

### Lifecycle hook mapping

| Handlebar hook | AI SDK equivalent |
|---|---|
| `run.beforeTool()` | Injected into each tool's `execute` function |
| `run.afterTool()` | Injected into each tool's `execute` function (after `exec`) |
| `run.afterLlm()` | `onStepFinish` callback |
| `run.end()` | Called after `generate`/`stream`/`respond` resolves or rejects |
| `withRun(run, fn)` | Wraps the body of each `generate`/`stream`/`respond` call |

---

## Option B — Manual integration with `generateText` / `streamText`

Use this approach when you want to use `generateText` or `streamText` directly rather than the `Agent` loop, or when building a custom agent loop.

```ts
import { generateText, tool } from "ai";
import { Handlebar, withRun, getCurrentRun } from "@handlebar/core";
import { uuidv7 } from "uuidv7";
import { z } from "zod";

// 1. Init client once.
const hb = await Handlebar.init({
  apiKey: process.env.HANDLEBAR_API_KEY,
  agent: { slug: "my-agent" },
});

// 2. Wrap tools to inject Handlebar governance.
//    getCurrentRun() retrieves the Run bound by withRun() below.
function makeTools() {
  return {
    search: tool({
      description: "Search the web",
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const run = getCurrentRun();
        if (!run) return fetchSearchResults(query);

        // --- before tool ---
        const decision = await run.beforeTool("search", { query }, ["read-only"]);
        if (decision.verdict === "BLOCK") {
          if (decision.control === "TERMINATE") {
            return { code: "HANDLEBAR_EXIT_RUN", reason: decision.message };
          }
          return { blocked: true, reason: decision.message };
        }

        // --- execute ---
        const start = Date.now();
        try {
          const result = await fetchSearchResults(query);
          await run.afterTool("search", { query }, result, Date.now() - start, undefined, ["read-only"]);
          return result;
        } catch (e) {
          await run.afterTool("search", { query }, undefined, Date.now() - start, e, ["read-only"]);
          throw e;
        }
      },
    }),
  };
}

// 3. Per-request: start a Run, bind it via ALS, call generateText.
async function handleUserRequest(userMessage: string, actorId: string) {
  const run = await hb.startRun({
    runId: uuidv7(),
    actor: { externalId: actorId },
  });

  try {
    const messages = [{ role: "user" as const, content: userMessage }];

    // beforeLlm: emit input audit event (and future PII redaction surface).
    // In the future, run.beforeLlm() may return modified messages (e.g. PII-redacted).
    // Use the returned array in generateText once that feature lands.
    const auditedMessages = await run.beforeLlm(
      messages.map((m) => ({ role: m.role, content: m.content })),
    );

    const result = await withRun(run, () =>
      generateText({
        model,
        messages: auditedMessages,
        tools: makeTools(),
        maxSteps: 10,
        onStepFinish: async ({ text, usage }) => {
          // afterLlm: emit token usage + LLM result audit event.
          await run.afterLlm({
            content: text ? [{ type: "text", text }] : [],
            model: { name: "gpt-4o", provider: "openai" },
            usage: {
              inputTokens: usage?.inputTokens,
              outputTokens: usage?.outputTokens,
            },
          });
        },
      }),
    );

    await run.end("success");
    return result.text;
  } catch (e) {
    await run.end("error");
    throw e;
  }
}
```

### Hook mapping for `generateText`

| Handlebar hook | Where to call it |
|---|---|
| `run.beforeLlm(messages)` | Before calling `generateText` / `streamText` |
| `run.afterLlm(response)` | Inside the `onStepFinish` callback |
| `run.beforeTool(name, args, tags)` | At the top of each tool's `execute` function |
| `run.afterTool(name, args, result, ms)` | After `exec` returns inside each tool's `execute` |
| `run.end(status)` | After the `generateText` call resolves/rejects |

### Streaming (`streamText`)

The same pattern applies to `streamText`. The `onStepFinish` callback fires after each complete step (not on each streamed chunk), so usage data is available:

```ts
const { textStream } = await withRun(run, () =>
  streamText({
    model,
    messages,
    tools: makeTools(),
    onStepFinish: async ({ text, usage }) => {
      await run.afterLlm({
        content: text ? [{ type: "text", text }] : [],
        model: { name: "gpt-4o", provider: "openai" },
        usage: { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens },
      });
    },
  }),
);
```

### `experimental_transform` (future PII redaction)

`streamText` supports `experimental_transform` — a `TransformStream` that intercepts every stream chunk before it reaches the consumer. This is the natural insertion point for streaming PII redaction once `run.beforeLlm` evolves to support it.

```ts
import type { TextStreamPart, ToolSet } from "ai";

// Conceptual example — PII redaction hook is not yet implemented in Handlebar core.
function handlebarTransform<TOOLS extends ToolSet>(run: Run) {
  return ({ stopStream }: { tools: TOOLS; stopStream: () => void }) =>
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        // Future: call run.redactChunk(chunk) for streaming PII redaction.
        controller.enqueue(chunk);
      },
    });
}

streamText({
  model,
  messages,
  experimental_transform: handlebarTransform(run),
});
```

---

## Shutdown

Call `hb.shutdown()` on process exit to flush any buffered audit events:

```ts
process.on("SIGTERM", async () => {
  await hb.shutdown();
  process.exit(0);
});
```
