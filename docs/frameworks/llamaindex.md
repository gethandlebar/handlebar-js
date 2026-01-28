# LlamaIndex TS Integration

This guide shows how to integrate Handlebar governance into agents built with [LlamaIndex.TS](https://ts.llamaindex.ai/).

## Overview

LlamaIndex.TS provides agent capabilities through its `AgentRunner` and tool abstractions. Handlebar integrates by wrapping tool execution with governance checks.

## Installation

```bash
npm install @handlebar/core llamaindex
```

## Integration Pattern

### 1. Setup GovernanceEngine

```typescript
import { GovernanceEngine } from "@handlebar/core";

const engine = new GovernanceEngine({
  tools: [
    { name: "queryIndex", categories: ["read", "search"] },
    { name: "insertDocument", categories: ["write", "data"] },
    { name: "deleteDocument", categories: ["write", "destructive"] },
    { name: "summarize", categories: ["read", "ai"] },
  ],
  rules: yourRules,
  mode: "enforce",
});
```

### 2. Create Governed Tool Wrapper

```typescript
import { FunctionTool, ToolMetadata, ToolOutput } from "llamaindex";

function createGovernedTool<T, R>(
  engine: GovernanceEngine,
  runCtx: RunContext,
  metadata: ToolMetadata<T>,
  fn: (input: T) => Promise<R>
): FunctionTool<T> {
  return FunctionTool.from(async (input: T): Promise<ToolOutput> => {
    // Before hook - check governance
    const decision = await engine.beforeTool(runCtx, metadata.name, input);

    if (engine.shouldBlock(decision)) {
      return {
        output: JSON.stringify({
          blocked: true,
          reason: decision.reason,
          requiresApproval: decision.effect === "human_in_the_loop",
        }),
        isError: true,
      };
    }

    // Execute the actual tool
    const startTime = Date.now();
    let result: R;
    let error: Error | undefined;

    try {
      result = await fn(input);
    } catch (e) {
      error = e as Error;
      throw e;
    } finally {
      // After hook - record execution
      await engine.afterTool(runCtx, metadata.name, input, {
        result: error ? undefined : result!,
        error,
        durationMs: Date.now() - startTime,
      });
    }

    return {
      output: JSON.stringify(result),
      isError: false,
    };
  }, metadata);
}
```

### 3. Define Your Tools with Governance

```typescript
import { VectorStoreIndex, Document } from "llamaindex";

// Your index (created elsewhere)
declare const index: VectorStoreIndex;

// Create run context for the session
const runCtx = engine.createRunContext("session-id", {
  userId: "user-123",
  role: "analyst",
});

// Query tool
const queryTool = createGovernedTool(
  engine,
  runCtx,
  {
    name: "queryIndex",
    description: "Search the document index for relevant information",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        topK: { type: "number", description: "Number of results" },
      },
      required: ["query"],
    },
  },
  async (input: { query: string; topK?: number }) => {
    const queryEngine = index.asQueryEngine();
    const response = await queryEngine.query({
      query: input.query,
    });
    return { answer: response.toString() };
  }
);

// Insert document tool
const insertTool = createGovernedTool(
  engine,
  runCtx,
  {
    name: "insertDocument",
    description: "Add a new document to the index",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Document content" },
        metadata: { type: "object", description: "Document metadata" },
      },
      required: ["content"],
    },
  },
  async (input: { content: string; metadata?: Record<string, unknown> }) => {
    const doc = new Document({ text: input.content, metadata: input.metadata });
    await index.insert(doc);
    return { success: true, message: "Document inserted" };
  }
);

// Delete document tool
const deleteTool = createGovernedTool(
  engine,
  runCtx,
  {
    name: "deleteDocument",
    description: "Remove a document from the index",
    parameters: {
      type: "object",
      properties: {
        docId: { type: "string", description: "Document ID to delete" },
      },
      required: ["docId"],
    },
  },
  async (input: { docId: string }) => {
    await index.deleteRefDoc(input.docId);
    return { success: true, message: "Document deleted" };
  }
);
```

### 4. Create the Agent

```typescript
import { OpenAI } from "llamaindex";
import { AgentRunner, FunctionCallingAgent } from "llamaindex";

const llm = new OpenAI({ model: "gpt-4" });

const agent = new FunctionCallingAgent({
  llm,
  tools: [queryTool, insertTool, deleteTool],
});

// Run the agent
const response = await agent.chat({
  message: "Find documents about machine learning and summarize them",
});

console.log(response.toString());
```

## Complete Example

```typescript
import { GovernanceEngine, RunContext, Rule } from "@handlebar/core";
import {
  OpenAI,
  VectorStoreIndex,
  Document,
  FunctionTool,
  FunctionCallingAgent,
  ToolMetadata,
  ToolOutput,
} from "llamaindex";

// Define rules
const rules: Rule[] = [
  // Only admins can delete documents
  {
    id: "admin-delete-only",
    description: "Only admins can delete documents",
    selector: { phase: "before", tools: ["deleteDocument"] },
    condition: {
      type: "context",
      path: "role",
      operator: "neq",
      value: "admin",
    },
    effect: "block",
    message: "Only administrators can delete documents",
  },
  // Rate limit queries
  {
    id: "query-rate-limit",
    description: "Limit queries to 100 per session",
    selector: { phase: "before", tools: ["queryIndex"] },
    condition: {
      type: "metric",
      name: "tool.queryIndex.count",
      operator: "gte",
      value: 100,
    },
    effect: "block",
    message: "Query rate limit exceeded for this session",
  },
  // Require approval for bulk inserts
  {
    id: "bulk-insert-approval",
    description: "Require approval for inserting large documents",
    selector: { phase: "before", tools: ["insertDocument"] },
    condition: {
      type: "input",
      path: "content",
      operator: "custom",
      signal: "document.isLarge",
    },
    effect: "human_in_the_loop",
    message: "Large document insertion requires approval",
  },
];

// Initialize governance
const engine = new GovernanceEngine({
  tools: [
    { name: "queryIndex", categories: ["read", "search"] },
    { name: "insertDocument", categories: ["write", "data"] },
    { name: "deleteDocument", categories: ["write", "destructive"] },
  ],
  rules,
  mode: "enforce",
});

// Register signals
engine.registerSignal("document.isLarge", async (ctx, toolName, args) => {
  const content = (args as { content?: string })?.content || "";
  return content.length > 10000; // Large if > 10k chars
});

// Tool wrapper function
function createGovernedTool<T, R>(
  engine: GovernanceEngine,
  runCtx: RunContext,
  metadata: ToolMetadata<T>,
  fn: (input: T) => Promise<R>
): FunctionTool<T> {
  return FunctionTool.from(async (input: T): Promise<ToolOutput> => {
    const decision = await engine.beforeTool(runCtx, metadata.name, input);

    if (engine.shouldBlock(decision)) {
      return {
        output: JSON.stringify({
          blocked: true,
          reason: decision.reason,
          requiresApproval: decision.effect === "human_in_the_loop",
        }),
        isError: true,
      };
    }

    const startTime = Date.now();
    let result: R;
    let error: Error | undefined;

    try {
      result = await fn(input);
    } catch (e) {
      error = e as Error;
      throw e;
    } finally {
      await engine.afterTool(runCtx, metadata.name, input, {
        result: error ? undefined : result!,
        error,
        durationMs: Date.now() - startTime,
      });
    }

    return { output: JSON.stringify(result), isError: false };
  }, metadata);
}

// Main function
async function main() {
  // Create index (simplified - normally loaded from storage)
  const index = await VectorStoreIndex.fromDocuments([
    new Document({ text: "Machine learning is a subset of AI..." }),
    new Document({ text: "Neural networks process data in layers..." }),
  ]);

  // Create run context
  const runCtx = engine.createRunContext("session-123", {
    userId: "user-456",
    role: "analyst", // Not admin - can't delete
  });

  // Create governed tools
  const queryTool = createGovernedTool(
    engine,
    runCtx,
    {
      name: "queryIndex",
      description: "Search documents",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
    async (input: { query: string }) => {
      const qe = index.asQueryEngine();
      return { answer: (await qe.query({ query: input.query })).toString() };
    }
  );

  const deleteTool = createGovernedTool(
    engine,
    runCtx,
    {
      name: "deleteDocument",
      description: "Delete a document",
      parameters: {
        type: "object",
        properties: {
          docId: { type: "string" },
        },
        required: ["docId"],
      },
    },
    async (input: { docId: string }) => {
      await index.deleteRefDoc(input.docId);
      return { success: true };
    }
  );

  // Create agent
  const llm = new OpenAI({ model: "gpt-4" });
  const agent = new FunctionCallingAgent({
    llm,
    tools: [queryTool, deleteTool],
  });

  // This will work - analyst can query
  const queryResponse = await agent.chat({
    message: "What is machine learning?",
  });
  console.log("Query response:", queryResponse.toString());

  // This will be blocked - analyst can't delete
  const deleteResponse = await agent.chat({
    message: "Delete the first document",
  });
  console.log("Delete response:", deleteResponse.toString());
  // Output will show the block message

  // Get audit log
  const logs = engine.getAuditLog(runCtx);
  console.log("Audit log:", logs);
}

main();
```

## Using with Different LLM Providers

LlamaIndex supports multiple LLM providers. Handlebar governance works with all of them:

```typescript
import { Anthropic, OpenAI, Gemini } from "llamaindex";

// Anthropic
const anthropicLlm = new Anthropic({ model: "claude-sonnet-4-20250514" });

// OpenAI
const openaiLlm = new OpenAI({ model: "gpt-4" });

// Google
const geminiLlm = new Gemini({ model: "gemini-pro" });

// Use any with the agent - governance remains the same
const agent = new FunctionCallingAgent({
  llm: anthropicLlm, // or openaiLlm, geminiLlm
  tools: [queryTool, insertTool, deleteTool],
});
```

## ReAct Agent Pattern

For ReAct-style agents:

```typescript
import { ReActAgent } from "llamaindex";

const agent = new ReActAgent({
  llm,
  tools: [queryTool, insertTool, deleteTool],
});

const response = await agent.chat({
  message: "Search for AI documents and summarize them",
});
```

Governance works identically - the wrapper intercepts all tool calls regardless of agent type.

## Streaming Responses

```typescript
const stream = await agent.chat({
  message: "Find and summarize ML documents",
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.response);
}
```

Governance checks happen before each tool execution, even in streaming mode.

## Key Differences from Vercel AI SDK

| Aspect | Vercel AI SDK | LlamaIndex |
|--------|---------------|------------|
| Integration | `HandlebarAgent` drop-in | Manual tool wrapping |
| Tool Definition | Zod schemas | JSON Schema objects |
| Agent Types | Single `Agent` class | Multiple (FunctionCalling, ReAct, etc.) |
| Streaming | Built-in | Via stream option |

## Next Steps

- Review [Rule Reference](../rules/README.md) for condition types
- See [Domain Templates](../rules/) for industry-specific rules
- Check [Rule Generation Workflow](../rules/rule-generation-workflow.md) for creating custom rules
