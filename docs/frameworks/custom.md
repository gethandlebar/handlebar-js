# Custom Agent Integration

This guide shows how to integrate Handlebar governance into custom agent loops or when using LLM SDKs directly (OpenAI, Anthropic, Google, etc.).

## Overview

When you're not using a framework like Vercel AI SDK or LangChain, you can integrate Handlebar directly into your custom agent loop using `@handlebar/core`.

## Installation

```bash
npm install @handlebar/core
```

## Core Integration Pattern

The fundamental pattern for any custom integration:

```typescript
import { GovernanceEngine, RunContext } from "@handlebar/core";

// 1. Initialize the engine
const engine = new GovernanceEngine({
  tools: [
    { name: "searchDatabase", categories: ["read", "data"] },
    { name: "sendEmail", categories: ["write", "communication"] },
    { name: "updateRecord", categories: ["write", "data"] },
  ],
  rules: yourRules,
  mode: "enforce", // or "audit"
});

// 2. Create a run context for each session
const runCtx = engine.createRunContext("session-id", {
  userId: "user-123",
  role: "operator",
});

// 3. Wrap tool execution
async function executeTool(
  toolName: string,
  args: unknown
): Promise<{ result?: unknown; blocked?: boolean; reason?: string }> {
  // Check governance before execution
  const decision = await engine.beforeTool(runCtx, toolName, args);

  if (engine.shouldBlock(decision)) {
    return {
      blocked: true,
      reason: decision.reason,
    };
  }

  // Execute the tool
  const startTime = Date.now();
  let result: unknown;
  let error: Error | undefined;

  try {
    result = await yourToolImplementation(toolName, args);
  } catch (e) {
    error = e as Error;
    throw e;
  } finally {
    // Record execution
    await engine.afterTool(runCtx, toolName, args, {
      result: error ? undefined : result,
      error,
      durationMs: Date.now() - startTime,
    });
  }

  return { result };
}
```

## OpenAI SDK Integration

```typescript
import OpenAI from "openai";
import { GovernanceEngine } from "@handlebar/core";

const openai = new OpenAI();

const engine = new GovernanceEngine({
  tools: [
    { name: "get_weather", categories: ["read", "external"] },
    { name: "send_notification", categories: ["write", "communication"] },
  ],
  rules: yourRules,
  mode: "enforce",
});

// Tool implementations
const toolFunctions: Record<string, (args: unknown) => Promise<unknown>> = {
  get_weather: async (args) => {
    const { location } = args as { location: string };
    // Your weather API call
    return { temperature: 72, condition: "sunny" };
  },
  send_notification: async (args) => {
    const { userId, message } = args as { userId: string; message: string };
    // Your notification logic
    return { sent: true };
  },
};

// Agent loop
async function runAgent(userMessage: string, sessionId: string) {
  const runCtx = engine.createRunContext(sessionId, {
    userId: "user-123",
  });

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "user", content: userMessage },
  ];

  const tools: OpenAI.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather for a location",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string" },
          },
          required: ["location"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "send_notification",
        description: "Send a notification to a user",
        parameters: {
          type: "object",
          properties: {
            userId: { type: "string" },
            message: { type: "string" },
          },
          required: ["userId", "message"],
        },
      },
    },
  ];

  while (true) {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      tools,
    });

    const choice = response.choices[0];

    if (choice.finish_reason === "stop") {
      return choice.message.content;
    }

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      messages.push(choice.message);

      for (const toolCall of choice.message.tool_calls) {
        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        // Governance check
        const decision = await engine.beforeTool(runCtx, toolName, args);

        let toolResult: string;

        if (engine.shouldBlock(decision)) {
          toolResult = JSON.stringify({
            error: decision.reason,
            blocked: true,
          });
        } else {
          const startTime = Date.now();
          try {
            const result = await toolFunctions[toolName](args);
            toolResult = JSON.stringify(result);

            await engine.afterTool(runCtx, toolName, args, {
              result,
              durationMs: Date.now() - startTime,
            });
          } catch (error) {
            await engine.afterTool(runCtx, toolName, args, {
              error: error as Error,
              durationMs: Date.now() - startTime,
            });
            throw error;
          }
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }
    }
  }
}
```

## Anthropic SDK Integration

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { GovernanceEngine } from "@handlebar/core";

const anthropic = new Anthropic();

const engine = new GovernanceEngine({
  tools: [
    { name: "search_docs", categories: ["read", "search"] },
    { name: "create_ticket", categories: ["write", "support"] },
  ],
  rules: yourRules,
  mode: "enforce",
});

const toolFunctions: Record<string, (args: unknown) => Promise<unknown>> = {
  search_docs: async (args) => {
    const { query } = args as { query: string };
    return { results: ["doc1", "doc2"] };
  },
  create_ticket: async (args) => {
    const { title, description } = args as {
      title: string;
      description: string;
    };
    return { ticketId: "TKT-123" };
  },
};

async function runAgent(userMessage: string, sessionId: string) {
  const runCtx = engine.createRunContext(sessionId, {
    userId: "user-456",
    role: "support",
  });

  const tools: Anthropic.Tool[] = [
    {
      name: "search_docs",
      description: "Search documentation",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
    {
      name: "create_ticket",
      description: "Create a support ticket",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string" },
          description: { type: "string" },
        },
        required: ["title", "description"],
      },
    },
  ];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  while (true) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      tools,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.type === "text" ? textBlock.text : "";
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b) => b.type === "tool_use"
      );

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        if (toolUse.type !== "tool_use") continue;

        const toolName = toolUse.name;
        const args = toolUse.input;

        // Governance check
        const decision = await engine.beforeTool(runCtx, toolName, args);

        if (engine.shouldBlock(decision)) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              error: decision.reason,
              blocked: true,
            }),
            is_error: true,
          });
        } else {
          const startTime = Date.now();
          try {
            const result = await toolFunctions[toolName](args);

            await engine.afterTool(runCtx, toolName, args, {
              result,
              durationMs: Date.now() - startTime,
            });

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            });
          } catch (error) {
            await engine.afterTool(runCtx, toolName, args, {
              error: error as Error,
              durationMs: Date.now() - startTime,
            });

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: (error as Error).message }),
              is_error: true,
            });
          }
        }
      }

      messages.push({ role: "user", content: toolResults });
    }
  }
}
```

## Google Gemini SDK Integration

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GovernanceEngine } from "@handlebar/core";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

const engine = new GovernanceEngine({
  tools: [
    { name: "lookup_product", categories: ["read", "inventory"] },
    { name: "place_order", categories: ["write", "orders", "financial"] },
  ],
  rules: yourRules,
  mode: "enforce",
});

const toolFunctions: Record<string, (args: unknown) => Promise<unknown>> = {
  lookup_product: async (args) => {
    const { productId } = args as { productId: string };
    return { name: "Widget", price: 29.99, inStock: true };
  },
  place_order: async (args) => {
    const { productId, quantity } = args as {
      productId: string;
      quantity: number;
    };
    return { orderId: "ORD-789", total: 29.99 * quantity };
  },
};

async function runAgent(userMessage: string, sessionId: string) {
  const runCtx = engine.createRunContext(sessionId, {
    userId: "user-789",
    role: "customer",
  });

  const model = genAI.getGenerativeModel({
    model: "gemini-pro",
    tools: [
      {
        functionDeclarations: [
          {
            name: "lookup_product",
            description: "Look up product information",
            parameters: {
              type: "object",
              properties: {
                productId: { type: "string" },
              },
              required: ["productId"],
            },
          },
          {
            name: "place_order",
            description: "Place an order",
            parameters: {
              type: "object",
              properties: {
                productId: { type: "string" },
                quantity: { type: "number" },
              },
              required: ["productId", "quantity"],
            },
          },
        ],
      },
    ],
  });

  const chat = model.startChat();
  let response = await chat.sendMessage(userMessage);

  while (true) {
    const functionCalls = response.functionCalls();

    if (!functionCalls || functionCalls.length === 0) {
      return response.text();
    }

    const functionResponses = [];

    for (const call of functionCalls) {
      const toolName = call.name;
      const args = call.args;

      // Governance check
      const decision = await engine.beforeTool(runCtx, toolName, args);

      if (engine.shouldBlock(decision)) {
        functionResponses.push({
          functionResponse: {
            name: toolName,
            response: { error: decision.reason, blocked: true },
          },
        });
      } else {
        const startTime = Date.now();
        try {
          const result = await toolFunctions[toolName](args);

          await engine.afterTool(runCtx, toolName, args, {
            result,
            durationMs: Date.now() - startTime,
          });

          functionResponses.push({
            functionResponse: {
              name: toolName,
              response: result,
            },
          });
        } catch (error) {
          await engine.afterTool(runCtx, toolName, args, {
            error: error as Error,
            durationMs: Date.now() - startTime,
          });

          functionResponses.push({
            functionResponse: {
              name: toolName,
              response: { error: (error as Error).message },
            },
          });
        }
      }
    }

    response = await chat.sendMessage(functionResponses);
  }
}
```

## Human-in-the-Loop Implementation

When a rule returns `human_in_the_loop` effect, you need to implement approval flow:

```typescript
import { GovernanceEngine, GovernanceDecision } from "@handlebar/core";

// Your approval mechanism (could be Slack, email, UI, etc.)
async function requestHumanApproval(
  toolName: string,
  args: unknown,
  reason: string
): Promise<boolean> {
  // Implement your approval flow
  // Return true if approved, false if rejected
  console.log(`Approval required for ${toolName}: ${reason}`);
  // In real implementation, this would wait for human input
  return true;
}

async function executeToolWithHITL(
  engine: GovernanceEngine,
  runCtx: RunContext,
  toolName: string,
  args: unknown
) {
  const decision = await engine.beforeTool(runCtx, toolName, args);

  if (decision.effect === "human_in_the_loop") {
    const approved = await requestHumanApproval(
      toolName,
      args,
      decision.reason || "Approval required"
    );

    if (!approved) {
      return {
        blocked: true,
        reason: "Human reviewer rejected the action",
      };
    }
    // Continue with execution if approved
  } else if (engine.shouldBlock(decision)) {
    return {
      blocked: true,
      reason: decision.reason,
    };
  }

  // Execute tool...
  const result = await yourToolImplementation(toolName, args);
  await engine.afterTool(runCtx, toolName, args, { result });
  return { result };
}
```

## Extracting Audit Logs

```typescript
// Get all logs for a session
const logs = engine.getAuditLog(runCtx);

console.log(JSON.stringify(logs, null, 2));
// [
//   {
//     timestamp: "2024-01-15T10:30:00Z",
//     phase: "before",
//     tool: "sendEmail",
//     args: { to: "user@example.com", subject: "Hello" },
//     decision: { effect: "allow" },
//     sessionId: "session-123"
//   },
//   {
//     timestamp: "2024-01-15T10:30:01Z",
//     phase: "after",
//     tool: "sendEmail",
//     result: { sent: true },
//     durationMs: 150
//   }
// ]

// Export for compliance
await saveToComplianceSystem(logs);
```

## Metrics Access

```typescript
// Get current metrics for a session
const metrics = engine.getMetrics(runCtx);

console.log(metrics);
// {
//   "tool.sendEmail.count": 5,
//   "tool.sendEmail.blocked": 1,
//   "tool.searchDatabase.count": 12,
//   "session.totalTools": 17,
//   "session.blockedTools": 1
// }

// Use metrics in your monitoring
if (metrics["session.blockedTools"] > 10) {
  alertSecurityTeam(runCtx.sessionId);
}
```

## Best Practices

### 1. Always Create Run Context Per Session

```typescript
// Good - each user session gets its own context
app.post("/chat", async (req, res) => {
  const runCtx = engine.createRunContext(req.sessionId, {
    userId: req.user.id,
    role: req.user.role,
    department: req.user.department,
  });
  // ...
});

// Bad - sharing context across sessions
const globalCtx = engine.createRunContext("global"); // Don't do this
```

### 2. Handle Errors Gracefully

```typescript
try {
  const result = await executeTool(toolName, args);
} catch (error) {
  // Still record the failure
  await engine.afterTool(runCtx, toolName, args, {
    error: error as Error,
    durationMs: Date.now() - startTime,
  });

  // Return error to LLM so it can recover
  return { error: (error as Error).message };
}
```

### 3. Use Audit Mode for Testing

```typescript
// Start in audit mode to see what would be blocked
const testEngine = new GovernanceEngine({
  tools,
  rules,
  mode: "audit", // Log but don't block
});

// Review logs to tune rules before enforcing
const logs = testEngine.getAuditLog(runCtx);
const wouldBlock = logs.filter(
  (l) => l.decision?.effect === "block" || l.decision?.effect === "human_in_the_loop"
);
console.log("Would have blocked:", wouldBlock);
```

### 4. Register Signals for Complex Conditions

```typescript
engine.registerSignal("risk.isHighValue", async (ctx, toolName, args) => {
  const amount = (args as { amount?: number })?.amount || 0;
  const userRiskScore = await getRiskScore(ctx.userId);
  return amount > 1000 && userRiskScore > 0.7;
});
```

## Next Steps

- Review [Rule Reference](../rules/README.md) for all condition types
- See [Domain Templates](../rules/) for industry-specific rules
- Check [Rule Generation Workflow](../rules/rule-generation-workflow.md)
