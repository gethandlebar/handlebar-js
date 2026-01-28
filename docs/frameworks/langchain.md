# LangChain JS Integration

This guide covers integrating Handlebar with LangChain JS using `@handlebar/core`.

---

## Overview

LangChain doesn't have a dedicated Handlebar package yet. Use `@handlebar/core` directly to wrap your tools with governance controls.

---

## Installation

```bash
npm install @handlebar/core @handlebar/governance-schema

# LangChain packages
npm install @langchain/core @langchain/anthropic langchain
```

---

## Integration Pattern

The pattern is:
1. Create a `GovernanceEngine` with your tools and rules
2. Create a helper function to wrap tools with governance
3. Wrap each LangChain tool using the helper
4. Use the wrapped tools in your agent

---

## Full Example

### 1. Setup Governance Engine

```typescript
// governance.ts
import { GovernanceEngine } from "@handlebar/core";
import type { Rule } from "@handlebar/governance-schema";

// Define tool metadata
const toolMeta = [
  { name: "verifyIdentity", categories: ["auth", "internal"] },
  { name: "getUserProfile", categories: ["read", "pii", "internal"] },
  { name: "issueRefund", categories: ["write", "financial", "irreversible"] },
];

// Define rules
const rules: Rule[] = [
  {
    id: "require-verification",
    enabled: true,
    priority: 100,
    name: "Require verification before PII access",
    selector: { phase: "tool.before", tool: { tagsAny: ["pii"] } },
    condition: { kind: "sequence", mustHaveCalled: ["verifyIdentity"] },
    effect: { type: "block", reason: "Please verify your identity first." },
  },
  {
    id: "refund-approval",
    enabled: true,
    priority: 90,
    name: "Large refunds require approval",
    selector: { phase: "tool.before", tool: { name: "issueRefund" } },
    condition: {
      kind: "signal",
      key: "refund.exceedsLimit",
      args: { amount: { from: "toolArg", path: "amount" } },
      op: "eq",
      value: true,
    },
    effect: { type: "hitl", reason: "Refunds over £100 require approval." },
  },
];

// Create engine
export const engine = new GovernanceEngine({
  tools: toolMeta,
  rules,
  mode: "enforce",
  verbose: true,
});

// Register signals
engine.registerSignal("refund.exceedsLimit", async ({ amount }) => {
  return amount > 100;
});

// Export a function to create run contexts
export function createRunContext(sessionId: string) {
  return engine.createRunContext(sessionId);
}
```

### 2. Create Governed Tool Helper

```typescript
// governed-tool.ts
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { engine, createRunContext } from "./governance";
import type { RunContext } from "@handlebar/core";

// Store run context per session
const runContexts = new Map<string, RunContext<any>>();

export function getOrCreateRunContext(sessionId: string) {
  if (!runContexts.has(sessionId)) {
    runContexts.set(sessionId, createRunContext(sessionId));
  }
  return runContexts.get(sessionId)!;
}

export function governedTool<T extends z.ZodType>({
  name,
  description,
  schema,
  func,
  sessionId,
}: {
  name: string;
  description: string;
  schema: T;
  func: (input: z.infer<T>) => Promise<string>;
  sessionId: string;
}): DynamicStructuredTool {
  const runCtx = getOrCreateRunContext(sessionId);

  return new DynamicStructuredTool({
    name,
    description,
    schema,
    func: async (input) => {
      // BEFORE: Check governance
      const decision = await engine.beforeTool(runCtx, name, input);

      if (engine.shouldBlock(decision)) {
        return `[BLOCKED] ${decision.reason}`;
      }

      // EXECUTE: Run the tool
      const start = Date.now();
      let result: string;
      let error: unknown;

      try {
        result = await func(input);
      } catch (e) {
        error = e;
        result = `Error: ${(e as Error).message}`;
      }

      // AFTER: Record the outcome
      await engine.afterTool(
        runCtx,
        name,
        Date.now() - start,
        input,
        result,
        error
      );

      return result;
    },
  });
}
```

### 3. Define Your Tools

```typescript
// tools.ts
import { z } from "zod";
import { governedTool } from "./governed-tool";

export function createTools(sessionId: string) {
  return [
    governedTool({
      name: "verifyIdentity",
      description: "Verify customer identity with a code",
      schema: z.object({
        userId: z.string().describe("The user ID"),
        code: z.string().describe("The verification code"),
      }),
      sessionId,
      func: async ({ userId, code }) => {
        // Your verification logic
        if (code === "123456") {
          return `Identity verified for user ${userId}`;
        }
        return "Verification failed. Please check the code.";
      },
    }),

    governedTool({
      name: "getUserProfile",
      description: "Get a customer's profile information",
      schema: z.object({
        userId: z.string().describe("The user ID"),
      }),
      sessionId,
      func: async ({ userId }) => {
        // Your profile logic
        return JSON.stringify({
          userId,
          name: "Alice Smith",
          email: "alice@example.com",
          plan: "premium",
        });
      },
    }),

    governedTool({
      name: "issueRefund",
      description: "Issue a refund for an order",
      schema: z.object({
        orderId: z.string().describe("The order ID"),
        amount: z.number().describe("Refund amount in GBP"),
      }),
      sessionId,
      func: async ({ orderId, amount }) => {
        // Your refund logic
        return `Refund of £${amount} issued for order ${orderId}`;
      },
    }),
  ];
}
```

### 4. Create and Run the Agent

```typescript
// agent.ts
import { ChatAnthropic } from "@langchain/anthropic";
import { createToolCallingAgent, AgentExecutor } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createTools } from "./tools";

async function main() {
  const sessionId = `session-${Date.now()}`;
  const tools = createTools(sessionId);

  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    temperature: 0,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", `You are a helpful customer support assistant.
      Always verify the customer's identity before accessing their profile.
      Be helpful but follow company policies.`],
    ["human", "{input}"],
    ["placeholder", "{agent_scratchpad}"],
  ]);

  const agent = createToolCallingAgent({
    llm,
    tools,
    prompt,
  });

  const executor = new AgentExecutor({
    agent,
    tools,
    verbose: true,
  });

  const result = await executor.invoke({
    input: "I need help with my account. My user ID is user-123.",
  });

  console.log("Result:", result.output);
}

main();
```

---

## Alternative: Wrapping Existing Tools

If you already have LangChain tools, wrap them with governance:

```typescript
import { DynamicStructuredTool } from "@langchain/core/tools";
import { engine } from "./governance";

function wrapToolWithGovernance(
  tool: DynamicStructuredTool,
  runCtx: RunContext<any>
): DynamicStructuredTool {
  const originalFunc = tool.func.bind(tool);

  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    func: async (input) => {
      // Governance check
      const decision = await engine.beforeTool(runCtx, tool.name, input);

      if (engine.shouldBlock(decision)) {
        return `[BLOCKED] ${decision.reason}`;
      }

      const start = Date.now();
      try {
        const result = await originalFunc(input);
        await engine.afterTool(runCtx, tool.name, Date.now() - start, input, result);
        return result;
      } catch (error) {
        await engine.afterTool(runCtx, tool.name, Date.now() - start, input, undefined, error);
        throw error;
      }
    },
  });
}

// Usage
const runCtx = engine.createRunContext("session-1");
const governedTools = originalTools.map(t => wrapToolWithGovernance(t, runCtx));
```

---

## Using with LangGraph

For LangGraph agents, wrap tools the same way:

```typescript
import { StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { createTools } from "./tools";

const sessionId = `langgraph-${Date.now()}`;
const tools = createTools(sessionId);

// Tools are already governed, use them in ToolNode
const toolNode = new ToolNode(tools);

// Build your graph as usual
const graph = new StateGraph({ channels: schema })
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  // ...
```

---

## Handling Blocked Tools

When a tool is blocked, the governance wrapper returns a `[BLOCKED]` message. The LLM will see this and can respond appropriately:

```typescript
// Example blocked response
"[BLOCKED] Please verify your identity first."

// The LLM might then respond:
"I need to verify your identity before I can access your profile. 
Could you please provide the verification code sent to your phone?"
```

To customize this behavior:

```typescript
func: async (input) => {
  const decision = await engine.beforeTool(runCtx, name, input);

  if (engine.shouldBlock(decision)) {
    // Custom response format
    return JSON.stringify({
      success: false,
      blocked: true,
      reason: decision.reason,
      suggestion: "Please verify identity first",
    });
  }
  // ...
}
```

---

## Environment Variables

```bash
# Anthropic (or your LLM provider)
ANTHROPIC_API_KEY=sk-ant-...

# Optional: Handlebar API
HANDLEBAR_API_KEY=hb_...
HANDLEBAR_API_ENDPOINT=https://api.gethandlebar.com
```

---

## Best Practices

1. **Create one run context per conversation** - This ensures tool history is tracked correctly for sequence rules.

2. **Use consistent tool names** - Tool names in `toolMeta` must match the names in your LangChain tools.

3. **Handle blocked responses gracefully** - Design your prompts so the LLM knows how to respond when tools are blocked.

4. **Clean up run contexts** - For long-running applications, remove old run contexts to prevent memory leaks.

```typescript
// Cleanup example
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

function cleanupOldContexts() {
  const now = Date.now();
  for (const [sessionId, ctx] of runContexts) {
    if (now - ctx.startTime > MAX_AGE_MS) {
      runContexts.delete(sessionId);
    }
  }
}
```
