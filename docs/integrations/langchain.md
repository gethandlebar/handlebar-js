# Handlebar + LangChain JS

The `@handlebar/langchain` adapter wraps a LangChain `AgentExecutor` (or any compatible `Runnable`) with full Handlebar governance — run lifecycle, LLM event logging, and tool-call enforcement.

---

## Installation

```bash
npm install @handlebar/langchain @handlebar/core @langchain/core
```

---

## Quick start

```ts
import { Handlebar } from "@handlebar/core";
import { HandlebarAgentExecutor, wrapTools } from "@handlebar/langchain";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIToolsAgent } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// 1. Init client once (e.g. at server startup).
const hb = await Handlebar.init({
  apiKey: process.env.HANDLEBAR_API_KEY,
  agent: { slug: "my-agent" },
});

// 2. Define your tools normally.
const searchTool = new DynamicStructuredTool({
  name: "search",
  description: "Search the web for information",
  schema: z.object({ query: z.string() }),
  func: async ({ query }) => fetchSearchResults(query),
});

// 3. Wrap tools with governance hooks BEFORE building the agent.
//    wrapTools() mutates the tool instances in place and returns the same array.
const tools = wrapTools([searchTool], {
  toolTags: { search: ["read-only"] },
});

// 4. Build the agent and executor as normal.
const llm = new ChatOpenAI({ model: "gpt-4o" });
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);
const agent = await createOpenAIToolsAgent({ llm, tools, prompt });
const executor = AgentExecutor.fromAgentAndTools({ agent, tools });

// 5. Wrap the executor with HandlebarAgentExecutor.
const hbExecutor = new HandlebarAgentExecutor({
  hb,
  executor,
  model: { name: "gpt-4o", provider: "openai" },
});

// 6. Invoke per request, passing actor / session info.
const result = await hbExecutor.invoke(
  { input: "What is the capital of France?" },
  { actor: { externalId: "user-123" }, sessionId: "session-abc" },
);
console.log(result.output);
```

---

## How it works

### Run lifecycle

`HandlebarAgentExecutor.invoke()` creates a new `Run` for each call:

1. `run.started` — emitted immediately on `startRun()`.
2. LLM and tool hooks fire during the agent loop (see below).
3. `run.ended` — emitted on completion, error, or governance termination; the event bus is flushed before returning.

### Tool governance (`wrapTools`)

`wrapTools()` intercepts each tool's `invoke()` method in place. On each tool call:

- `run.beforeTool(name, args, tags)` is called first — evaluates governance rules.
- **ALLOW** → proceeds with normal execution; `run.afterTool(...)` is called after.
- **BLOCK + CONTINUE** → skips execution; returns a JSON-encoded blocked message so the LLM can respond gracefully.
- **BLOCK + TERMINATE** → throws `HandlebarTerminationError`; `HandlebarAgentExecutor` catches it and ends the run with status `"interrupted"`.

### LLM event logging (`HandlebarCallbackHandler`)

`HandlebarAgentExecutor` automatically attaches a `HandlebarCallbackHandler` to each `executor.invoke()` call. It bridges LangChain's callback system to Handlebar's hooks:

| LangChain callback        | Handlebar hook        | Notes                                                              |
|---------------------------|-----------------------|--------------------------------------------------------------------|
| `handleChatModelStart`    | `run.beforeLlm`       | Delta-tracked — only new messages emitted per step                 |
| `handleLLMEnd`            | `run.afterLlm`        | Extracts text, tool calls, and token usage from `LLMResult`        |

Delta tracking ensures that on multi-step agent loops (where LangChain accumulates the full message history), only messages new since the last LLM call are forwarded to `run.beforeLlm`. This prevents duplicate `message.raw.created` events.

---

## API reference

### `wrapTools(tools, opts?)`

Wraps an array of LangChain tools with Handlebar governance hooks. Mutates tool instances in place; returns the same array.

```ts
const tools = wrapTools([searchTool, codeTool], {
  toolTags: {
    search: ["read-only"],
    code_executor: ["execution"],
  },
});
```

### `wrapTool(tool, tags?)`

Wraps a single tool. Use when you need to wrap tools individually.

### `HandlebarAgentExecutor`

```ts
const hbExecutor = new HandlebarAgentExecutor({
  hb,                                        // HandlebarClient from Handlebar.init()
  executor,                                  // AgentExecutor or any compatible Runnable
  model: { name: "gpt-4o", provider: "openai" },
  runDefaults: { runTtlMs: 60_000 },         // optional: applied to every run
});

const result = await hbExecutor.invoke(
  { input: "..." },
  {
    actor: { externalId: "user-123" },        // optional
    sessionId: "session-abc",                 // optional: groups runs into a session
    tags: { environment: "production" },      // optional: arbitrary run tags
  },
);
```

### `HandlebarCallbackHandler`

If you need the callback handler outside of `HandlebarAgentExecutor` (e.g. to attach to a chain rather than an executor):

```ts
import { HandlebarCallbackHandler } from "@handlebar/langchain";
import { withRun } from "@handlebar/core";

const run = await hb.startRun({ runId: uuidv7(), model: { name: "gpt-4o" } });
const handler = new HandlebarCallbackHandler(run, { name: "gpt-4o", provider: "openai" });

await withRun(run, async () => {
  const result = await chain.invoke({ input: "..." }, { callbacks: [handler] });
  await run.end("success");
  return result;
});
```

### `HandlebarTerminationError`

Thrown by a wrapped tool when a `BLOCK + TERMINATE` governance decision is made. `HandlebarAgentExecutor` catches this automatically and ends the run with `"interrupted"`. If you are managing the run lifecycle manually, catch it yourself:

```ts
try {
  const result = await executor.invoke(input, { callbacks: [handler] });
  await run.end("success");
} catch (err) {
  await run.end(err instanceof HandlebarTerminationError ? "interrupted" : "error");
  throw err;
}
```

---

## Limitations

- **`handleToolStart` cannot block**: LangChain's callback system is observational — callbacks fire around tool execution but cannot intercept it. Tool wrapping via `wrapTools()` / `wrapTool()` is required to enforce `BLOCK` decisions.
- **Chat models only**: `HandlebarCallbackHandler` uses `handleChatModelStart`, which fires for chat models (`ChatOpenAI`, etc.). Plain completion LLMs use `handleLLMStart` (prompts as strings); these are not currently converted to `message.raw.created` events.
- **Single batch assumed**: For batched LLM calls (`messages: BaseMessage[][]`), only the first batch (`messages[0]`) is forwarded to `run.beforeLlm`. Batched inference is uncommon in agent loops.
