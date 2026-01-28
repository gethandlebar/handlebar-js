# Vercel AI SDK Integration

This guide covers integrating Handlebar with the Vercel AI SDK v5+.

---

## Overview

The `@handlebar/ai-sdk-v5` package provides a drop-in replacement for the AI SDK's `Agent` class. It wraps your agent with governance controls while maintaining the same API.

---

## Installation

```bash
npm install @handlebar/ai-sdk-v5 @handlebar/core ai

# Plus your model provider
npm install @ai-sdk/anthropic   # or @ai-sdk/openai, @ai-sdk/google, etc.
```

---

## Quick Start

### Before (Standard AI SDK)

```typescript
import { Experimental_Agent as Agent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const agent = new Agent({
  system: "You are a helpful assistant.",
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { myTool1, myTool2 },
});

const result = await agent.generate([{ prompt: "Help me" }]);
```

### After (With Handlebar)

```typescript
import { HandlebarAgent } from "@handlebar/ai-sdk-v5";
import { anthropic } from "@ai-sdk/anthropic";

const agent = new HandlebarAgent({
  system: "You are a helpful assistant.",
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { myTool1, myTool2 },
  
  // Handlebar configuration
  agent: {
    slug: "my-agent",
  },
  governance: {
    categories: toolCategories,
    mode: "enforce",
  },
});

const result = await agent.generate(
  [{ prompt: "Help me" }],
  { enduser: { externalId: "user-123" } }
);
```

---

## Model Providers

The AI SDK supports multiple providers. Install and use any:

```typescript
// Anthropic
import { anthropic } from "@ai-sdk/anthropic";
const model = anthropic("claude-sonnet-4-20250514");

// OpenAI
import { openai } from "@ai-sdk/openai";
const model = openai("gpt-4o");

// Google
import { google } from "@ai-sdk/google";
const model = google("gemini-1.5-pro");

// Amazon Bedrock
import { bedrock } from "@ai-sdk/amazon-bedrock";
const model = bedrock("anthropic.claude-3-sonnet-20240229-v1:0");

// Azure OpenAI
import { azure } from "@ai-sdk/azure";
const model = azure("your-deployment-name");
```

---

## Full Example

### 1. Define Tools with Categories

```typescript
// tools.ts
import { tool } from "ai";
import { z } from "zod";

export const toolCategories: Record<string, string[]> = {};

export const verifyIdentity = tool({
  description: "Verify customer identity with OTP",
  inputSchema: z.object({
    userId: z.string(),
    code: z.string(),
  }),
  execute: async ({ userId, code }) => {
    // Your verification logic
    return { verified: code === "123456" };
  },
});
toolCategories.verifyIdentity = ["auth", "internal"];

export const getUserProfile = tool({
  description: "Get customer profile",
  inputSchema: z.object({
    userId: z.string(),
  }),
  execute: async ({ userId }) => {
    // Your profile fetch logic
    return { userId, name: "Alice", email: "alice@example.com" };
  },
});
toolCategories.getUserProfile = ["read", "pii", "internal"];

export const issueRefund = tool({
  description: "Issue a refund for an order",
  inputSchema: z.object({
    orderId: z.string(),
    amount: z.number(),
  }),
  execute: async ({ orderId, amount }) => {
    // Your refund logic
    return { success: true, refunded: amount };
  },
});
toolCategories.issueRefund = ["write", "financial", "irreversible"];
```

### 2. Define Rules

```typescript
// rules.ts
import type { Rule } from "@handlebar/governance-schema";

export const rules: Rule[] = [
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
    id: "refund-limit",
    enabled: true,
    priority: 90,
    name: "Limit refund amount",
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
```

### 3. Create the Agent

```typescript
// agent.ts
import { HandlebarAgent } from "@handlebar/ai-sdk-v5";
import { anthropic } from "@ai-sdk/anthropic";
import { stepCountIs } from "ai";
import { verifyIdentity, getUserProfile, issueRefund, toolCategories } from "./tools";
import { rules } from "./rules";

const agent = new HandlebarAgent({
  system: `You are a customer support assistant. 
    Always verify the customer's identity before accessing their data.
    Be helpful but follow company policies.`,
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { verifyIdentity, getUserProfile, issueRefund },
  stopWhen: stepCountIs(10),

  agent: {
    slug: "customer-support",
    name: "Customer Support Agent",
    description: "Handles customer inquiries and refunds",
    tags: ["support", "production"],
  },
  governance: {
    categories: toolCategories,
    rules,
    mode: "enforce", // or "monitor" for testing
    verbose: true,   // Log governance decisions
  },
});

// Register custom signals
agent.governance.registerSignal("refund.exceedsLimit", async ({ amount }) => {
  return amount > 100;
});

export { agent };
```

### 4. Run the Agent

```typescript
// index.ts
import { agent } from "./agent";

async function main() {
  const result = await agent.generate(
    [{ prompt: "I need a refund for order ORD-12345" }],
    {
      enduser: {
        externalId: "customer-789",
        metadata: { 
          role: "customer",
          plan: "premium",
        },
        group: {
          externalId: "org-456",
          name: "Acme Corp",
        },
      },
    }
  );

  console.log(result.text);
  console.log("Steps:", result.steps.length);
}

main();
```

---

## API Reference

### HandlebarAgent Constructor

```typescript
new HandlebarAgent({
  // Standard AI SDK options
  system: string,
  model: LanguageModel,
  tools: ToolSet,
  stopWhen?: StopCondition,
  onStepFinish?: (step) => void,

  // Handlebar options
  agent: {
    slug: string,           // Required: unique identifier
    name?: string,          // Display name
    description?: string,   // Agent description
    tags?: string[],        // Tags for categorization
  },
  governance: {
    categories: Record<string, string[]>,  // Tool categories
    rules?: Rule[],         // Local rules (optional if using API)
    mode?: "enforce" | "monitor",  // Default: "enforce"
    verbose?: boolean,      // Log decisions to console
  },
});
```

### Running the Agent

```typescript
// generate() - Returns complete response
const result = await agent.generate(
  [{ prompt: "User message" }],
  {
    enduser: {
      externalId: string,           // Your user ID
      metadata?: Record<string, string>,  // User attributes for rules
      group?: {
        externalId: string,
        name?: string,
        metadata?: Record<string, string>,
      },
    },
  }
);

// stream() - Returns streaming response
const stream = await agent.stream(
  [{ prompt: "User message" }],
  { enduser: { externalId: "user-123" } }
);
```

### Registering Signals

```typescript
agent.governance.registerSignal("signal.key", async (args, context) => {
  // args: Signal arguments from the rule
  // context: { ctx: RunContext, call: ToolCall, subjects: SubjectRef[] }
  return true; // or false, or any value to compare
});
```

### Registering Subject Extractors

```typescript
agent.governance.registerSubjectExtractor("toolName", (extractorArgs) => {
  // extractorArgs: { tool, toolName, toolArgs, runContext }
  return [
    {
      subjectType: "customer",
      role: "primary",
      value: extractorArgs.toolArgs.customerId,
      idSystem: "crm_id",
    },
  ];
});
```

### Registering Metrics

```typescript
import type { AgentMetricHook } from "@handlebar/core";

const metric: AgentMetricHook<"tool.after"> = {
  phase: "tool.after",
  key: "refund_amount",
  run: async ({ toolName, result }) => {
    if (toolName !== "issueRefund") return;
    return { value: result.refunded, unit: "GBP" };
  },
};

agent.governance.registerMetric(metric);
```

---

## Environment Variables

```bash
# Model provider (choose one)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=...

# Optional: Handlebar API for remote rules
HANDLEBAR_API_KEY=hb_...
HANDLEBAR_API_ENDPOINT=https://api.gethandlebar.com
```

---

## Best Practices

1. **Start in monitor mode** - Use `mode: "monitor"` during development to see what would be blocked without actually blocking.

2. **Use descriptive tool categories** - Good categories make rules more maintainable.

3. **Always identify the end user** - Pass `enduser.externalId` for proper audit trails and user-specific rules.

4. **Register signals for complex logic** - Keep rules declarative; put business logic in signals.

5. **Test rule interactions** - Rules are evaluated by priority; ensure they work together correctly.

---

## Troubleshooting

### Tool is blocked unexpectedly

1. Enable `verbose: true` to see governance decisions
2. Check rule priorities (higher = evaluated first)
3. Verify the tool has correct categories
4. Check if required tools are in the call history

### Signals not working

1. Ensure the signal is registered before the agent runs
2. Check signal key matches exactly (case-sensitive)
3. Verify signal args are correctly mapped from rule

### Rules not loading from API

1. Check `HANDLEBAR_API_KEY` is set
2. Verify `agent.slug` matches the API configuration
3. Check network connectivity to the API endpoint
