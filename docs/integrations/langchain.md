# Handlebar + LangChain JS

LangChain's callback system (`BaseCallbackHandler`) maps almost directly onto Handlebar's lifecycle hooks, making it one of the easiest frameworks to integrate.

> **Note:** No pre-built adapter package exists yet for LangChain. The patterns below show how to wire Handlebar directly into a LangChain agent.

---

## Architecture

LangChain callbacks are **observational** — they fire around tool and LLM invocations but cannot abort them mid-flight. For full governance enforcement (blocking tool calls), wrap the tools directly. For audit-only use cases, the callback approach is sufficient.

| Handlebar hook | LangChain callback | Notes |
|---|---|---|
| `run.beforeTool(name, args, tags)` | `handleToolStart` | Tool wrapping required to enforce BLOCK |
| `run.afterTool(name, args, result, ms)` | `handleToolEnd` | Input/output arrive as strings |
| `run.beforeLlm(messages)` | `handleLLMStart` | Prompts arrive serialized |
| `run.afterLlm(response)` | `handleLLMEnd` | Token usage is in `output.llmOutput` |

---

## Option A — Tool wrapping (full governance)

Wrap tools so Handlebar can intercept and optionally block before execution. This is the recommended approach when you need `BLOCK` decisions to be enforced.

```ts
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Handlebar, type Run } from "@handlebar/core";
import { uuidv7 } from "uuidv7";
import { z } from "zod";

// 1. Init client once.
const hb = await Handlebar.init({
  apiKey: process.env.HANDLEBAR_API_KEY,
  agent: { slug: "my-agent" },
});

// 2. Wrap a LangChain tool with Handlebar governance.
function wrapTool(
  originalTool: DynamicStructuredTool,
  run: Run,
  tags: string[] = [],
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: originalTool.name,
    description: originalTool.description,
    schema: originalTool.schema,
    func: async (input, runManager) => {
      // --- before tool ---
      const decision = await run.beforeTool(originalTool.name, input, tags);

      if (decision.verdict === "BLOCK") {
        if (decision.control === "TERMINATE") {
          // Throw to surface the termination upward; catch and call run.end() in the caller.
          throw new Error(`HANDLEBAR_TERMINATE: ${decision.message}`);
        }
        return JSON.stringify({ blocked: true, reason: decision.message });
      }

      // --- execute ---
      const start = Date.now();
      try {
        const result = await originalTool._call(input, runManager);
        await run.afterTool(originalTool.name, input, result, Date.now() - start, undefined, tags);
        return result;
      } catch (e) {
        await run.afterTool(originalTool.name, input, undefined, Date.now() - start, e, tags);
        throw e;
      }
    },
  });
}

// 3. Define your tools normally.
const searchTool = new DynamicStructuredTool({
  name: "search",
  description: "Search the web for information",
  schema: z.object({ query: z.string() }),
  func: async ({ query }) => fetchSearchResults(query),
});

// 4. Per-request: create a run, wrap tools, execute agent.
async function runAgent(input: string, actorId: string): Promise<string> {
  const run = await hb.startRun({
    runId: uuidv7(),
    actor: { externalId: actorId },
  });

  const wrappedTools = [
    wrapTool(searchTool, run, ["read-only"]),
  ];

  const model = new ChatOpenAI({ model: "gpt-4o" });
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a helpful assistant."],
    ["human", "{input}"],
    ["placeholder", "{agent_scratchpad}"],
  ]);

  const agent = await createOpenAIFunctionsAgent({ llm: model, tools: wrappedTools, prompt });
  const executor = AgentExecutor.fromAgentAndTools({ agent, tools: wrappedTools });

  try {
    const result = await executor.invoke({ input });
    await run.end("success");
    return result.output;
  } catch (e) {
    // Check if this is a Handlebar termination signal.
    const msg = e instanceof Error ? e.message : "";
    await run.end(msg.startsWith("HANDLEBAR_TERMINATE:") ? "interrupted" : "error");
    throw e;
  }
}
```

---

## Option B — Callback handler (audit / shadow mode)

Use a `BaseCallbackHandler` when you only need audit logging, or when operating in `shadow` or `off` enforce mode where BLOCK decisions are not enforced.

```ts
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { LLMResult } from "@langchain/core/outputs";
import type { Run } from "@handlebar/core";

export class HandlebarCallbackHandler extends BaseCallbackHandler {
  name = "HandlebarCallbackHandler";

  private run: Run;
  // Correlate LangChain runId → tool start time for duration tracking.
  private readonly startTimes = new Map<string, number>();

  constructor(run: Run) {
    super();
    this.run = run;
  }

  // --- Tool lifecycle ---

  async handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
  ): Promise<void> {
    this.startTimes.set(runId, Date.now());

    // Tool name is the last element of the id array, or tool.name.
    const name = (tool.id?.at(-1) ?? tool.name ?? "unknown") as string;
    let args: unknown = input;
    try { args = JSON.parse(input); } catch {}

    // In shadow/off mode: still evaluates (or skips) but never blocks.
    await this.run.beforeTool(name, args);
  }

  async handleToolEnd(output: string, runId: string): Promise<void> {
    const durationMs = Date.now() - (this.startTimes.get(runId) ?? Date.now());
    this.startTimes.delete(runId);

    let result: unknown = output;
    try { result = JSON.parse(output); } catch {}

    // afterTool increments stepIndex and emits the tool.result audit event.
    // Tool name is not available here from LangChain — use a placeholder
    // or correlate via a runId → toolName map set in handleToolStart.
    await this.run.afterTool("unknown", undefined, result, durationMs);
  }

  async handleToolError(error: Error, runId: string): Promise<void> {
    const durationMs = Date.now() - (this.startTimes.get(runId) ?? Date.now());
    this.startTimes.delete(runId);
    await this.run.afterTool("unknown", undefined, undefined, durationMs, error);
  }

  // --- LLM lifecycle ---

  async handleLLMStart(
    llm: Serialized,
    prompts: string[],
  ): Promise<void> {
    const messages = prompts.map((p) => ({
      role: "user" as const,
      content: p,
    }));
    await this.run.beforeLlm(messages);
  }

  async handleLLMEnd(output: LLMResult): Promise<void> {
    const text = output.generations[0]?.[0]?.text ?? "";
    const tokenUsage = output.llmOutput?.tokenUsage as
      | { promptTokens?: number; completionTokens?: number }
      | undefined;

    await this.run.afterLlm({
      content: text ? [{ type: "text", text }] : [],
      model: { name: "unknown" }, // LangChain doesn't surface model name here
      usage: {
        inputTokens: tokenUsage?.promptTokens,
        outputTokens: tokenUsage?.completionTokens,
      },
    });
  }
}
```

### Registering the handler

```ts
const run = await hb.startRun({ runId: uuidv7() });
const handler = new HandlebarCallbackHandler(run);

// Attach to executor or chain:
const result = await executor.invoke(
  { input: "What is the weather in London?" },
  { callbacks: [handler] },
);

await run.end("success");
```

---

## Limitations of the callback approach

- **No blocking**: LangChain callbacks cannot abort tool execution after `handleToolStart` fires. Use Option A (tool wrapping) for `enforceMode: "enforce"`.
- **Tool name in `handleToolEnd`**: The `runId` is available in `handleToolEnd` but the tool name is not. Correlate them with a `Map<string, string>` set in `handleToolStart` (keyed by LangChain `runId`).
- **Serialised I/O**: Tool input/output arrive as JSON strings; parse before passing to `run.beforeTool` / `run.afterTool`.
