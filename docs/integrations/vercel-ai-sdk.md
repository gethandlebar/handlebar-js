# Handlebar + Vercel AI SDK

Handlebar support for Vercel AI is split by major version:
- [`ai >= 6`](#v6)
- [`ai == 5`](#v5)

## Prerequisites

- You will need a [Handlebar account](https://app.gethandlebar.com)
- On the platform, create an API key and set it as an environment variable for your agent as `HANDLEBAR_API_KEY`

## v6

**Package:** `@handlebar/ai-sdk`\n
**Support:** `ai@^6.0.0`

### Basic setup

`HandlebarAgent` is a drop-in wrapper around the AI SDK's `ToolLoopAgent`. It wires up all lifecycle hooks automatically.

```diff your-agent.ts
- import { ToolLoopAgent } from "ai";
+ import { HandlebarAgent, Handlebar } from "@handlebar/ai-sdk";
import { openai } from "@ai-sdk/openai";
import { tool } from "ai";
import { z } from "zod";

// 1. Init the client once (e.g. at server start).
const hb = await Handlebar.init({
  agent: { slug: "my-agent" },
});

// 2. Define tools as normal AI SDK tools.
const tools = {
  search: tool({
    description: "Search the web",
    parameters: z.object({ query: z.string() }),
    execute: async ({ query }) => fetchSearchResults(query),
  })
};

- const agent = new ToolLoopAgent({
+ const agent = new HandlebarAgent({
+   hb, // Pass in your initialised Handlebar client
    tools,
    model: "openai/gpt-5-nano",
});

await agent.generate({ prompt: "What is the weather like in London right now?" });
```

## Optional config

### Track enduser

You can provide an identify to Handlebar for the enduser/actor on whose behalf the agent is acting at runtime.
This allows Handlebar to enforce per-user policies you've configured.

```diff your-agent.ts
const agent = new HandlebarAgent(...);

await agent.generate({
    prompt: "What is the weather like in London right now?",
+   actor: { externalId: "your-user-identifier" },
});
```

The full `actor` spec allows you to provide (optional) tags/metadata for the user,
which allows to be applied on groups of users:

```ts
{
  externalId: string;
  name?: string;
  metadata?: Record<string, string>;
  // Single group membership for user.
  group?: {
    externalId: string;
    name?: string;
    metadata?: Record<string, string>;
  }
}
```

### Tool tags

Similarly to endusers, you can tag tools with metadata to enforce Handlebar policies on groups
of tools based on their capabilities. `@handlebar/ai-sdk` exports a drop-in replacement for `tool`
which allows you to provide this metadata:

```diff your-agent.ts
- import { tool } from "ai"
+ import { tool } from "@handlebar/ai-sdk";

const yourTool = tool({
  title: "A tool",
  inputSchema: z.object({}),
  execute: async () => { return 0 },
+ tags: ["pii", "read", "sensitive", "expensive"], // Your tags
});
```

---

## v5

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

## Lifecycle hook mapping

| Handlebar hook | AI SDK equivalent |
|---|---|
| `run.beforeTool()` | Injected into each tool's `execute` function |
| `run.afterTool()` | Injected into each tool's `execute` function (after `exec`) |
| `run.afterLlm()` | `onStepFinish` callback |
| `run.end()` | Called after `generate`/`stream`/`respond` resolves or rejects |
| `withRun(run, fn)` | Wraps the body of each `generate`/`stream`/`respond` call |
