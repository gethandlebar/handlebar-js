# Deploying Handlebar into an AI Agent

This guide walks through integrating Handlebar governance into your AI agent application.

---

## Claude Code Skill

For automated integration, use the included Claude Code skill:

```
/handlebar
```

The skill will:
1. Detect your agent framework (Vercel AI SDK, LangChain, LlamaIndex, custom)
2. Install the correct packages
3. Categorize your tools
4. Generate domain-specific rules
5. Scaffold the integration code

### Installing the Skill

**Option 1: Project-level (for your team)**

The skill is included in this repo at `.claude/skills/handlebar.md`. Anyone who clones the repo gets access.

**Option 2: User-level (for personal use across projects)**

```bash
mkdir -p ~/.claude/skills
curl -o ~/.claude/skills/handlebar.md https://raw.githubusercontent.com/gethandlebar/handlebar-js/main/.claude/skills/handlebar.md
```

---

## Overview

Handlebar provides runtime governance for AI agents:
- **Tool-level controls**: Block, allow, or require approval for tool calls
- **Audit logging**: Track all agent actions for compliance and debugging
- **Custom metrics**: Monitor token usage, costs, data transfer, and business metrics
- **Signals and subjects**: Contextual rules based on your business logic

---

## Quick Navigation

| Task | Document |
|------|----------|
| **Integrate with a framework** | See [Framework Guides](#framework-integration) below |
| **Understand rule structure** | [rules/README.md](./rules/README.md) |
| **Generate domain-specific rules** | [rules/rule-generation-workflow.md](./rules/rule-generation-workflow.md) |
| **Healthcare agent rules** | [rules/healthcare.md](./rules/healthcare.md) |
| **Financial services rules** | [rules/finance.md](./rules/finance.md) |
| **E-commerce agent rules** | [rules/ecommerce.md](./rules/ecommerce.md) |
| **HR/internal agent rules** | [rules/hr.md](./rules/hr.md) |

---

## Framework Support

| Framework | Package | Guide |
|-----------|---------|-------|
| Vercel AI SDK v5+ | `@handlebar/ai-sdk-v5` | [frameworks/vercel-ai-sdk.md](./frameworks/vercel-ai-sdk.md) |
| LangChain JS | `@handlebar/core` | [frameworks/langchain.md](./frameworks/langchain.md) |
| LlamaIndex TS | `@handlebar/core` | [frameworks/llamaindex.md](./frameworks/llamaindex.md) |
| OpenAI/Anthropic SDK | `@handlebar/core` | [frameworks/custom.md](./frameworks/custom.md) |
| Custom Agent Loop | `@handlebar/core` | [frameworks/custom.md](./frameworks/custom.md) |

### Model Agnostic

Handlebar is **model-agnostic**. The governance layer operates at the tool-call level, independent of which LLM you use:

- Anthropic Claude (all versions)
- OpenAI GPT-4, GPT-4o, o1, etc.
- Google Gemini
- Mistral, Cohere, Groq
- Local models via Ollama
- Any tool-calling capable LLM

---

## Installation

### For Vercel AI SDK v5+

```bash
npm install @handlebar/ai-sdk-v5 @handlebar/core ai
# Plus your model provider
npm install @ai-sdk/anthropic  # or @ai-sdk/openai, @ai-sdk/google, etc.
```

### For All Other Frameworks

```bash
npm install @handlebar/core @handlebar/governance-schema
```

---

## Framework Integration

### Quick Framework Detection

Look for these patterns in the codebase to identify the framework:

| Framework | Detection Pattern |
|-----------|-------------------|
| **Vercel AI SDK** | `import { Agent } from "ai"` or `import { Experimental_Agent } from "ai"` |
| **LangChain JS** | `import { AgentExecutor } from "langchain/agents"` or `@langchain/core` |
| **LlamaIndex TS** | `import { ... } from "llamaindex"` |
| **OpenAI SDK** | `import OpenAI from "openai"` with manual tool loop |
| **Anthropic SDK** | `import Anthropic from "@anthropic-ai/sdk"` with manual tool loop |

### Integration Approach

| Framework | Method |
|-----------|--------|
| Vercel AI SDK | Replace `Agent` with `HandlebarAgent` - see [guide](./frameworks/vercel-ai-sdk.md) |
| All Others | Wrap tool execution with `GovernanceEngine` - see [framework guides](./frameworks/) |

### Core Pattern (All Frameworks)

```typescript
import { GovernanceEngine } from "@handlebar/core";

// 1. Create engine with tools and rules
const engine = new GovernanceEngine({
  tools: [{ name: "myTool", categories: ["read", "pii"] }],
  rules: yourRules,
  mode: "enforce",
});

// 2. Create run context per session
const runCtx = engine.createRunContext("session-id");

// 3. Wrap tool execution
async function executeTool(toolName: string, args: unknown) {
  // Check BEFORE
  const decision = await engine.beforeTool(runCtx, toolName, args);
  if (engine.shouldBlock(decision)) {
    return { blocked: true, reason: decision.reason };
  }
  
  // Execute
  const start = Date.now();
  const result = await actualToolFn(args);
  
  // Record AFTER
  await engine.afterTool(runCtx, toolName, Date.now() - start, args, result);
  return result;
}
```

---

## Deployment Modes

| Mode | Behavior |
|------|----------|
| `enforce` | Rule violations block tool execution |
| `monitor` | Violations are logged but tools execute normally |

Start with `monitor` mode in development/staging, then switch to `enforce` in production.

---

## Environment Setup

```bash
# Model provider (choose one)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=...

# Optional: Handlebar API for remote rules, audit logs, and HITL
HANDLEBAR_API_KEY=hb_...
HANDLEBAR_API_ENDPOINT=https://api.gethandlebar.com
```

---

## Complete Example

See `examples/ai-sdk-v5/customer-support/` for a full working example.

```bash
cd examples/ai-sdk-v5
bun install
ANTHROPIC_API_KEY=sk-ant-... bun run customer-support/index.ts
```

---

## Claude Code Skill Instructions

This section provides routing instructions for Claude Code when working with Handlebar.

### Task Routing

| User Request | Action |
|--------------|--------|
| "Add Handlebar to my agent" | 1. Detect framework, 2. Read relevant [framework guide](./frameworks/), 3. Implement |
| "Generate governance rules" | Read [rule-generation-workflow.md](./rules/rule-generation-workflow.md) |
| "Add rules for healthcare agent" | Read [healthcare.md](./rules/healthcare.md) |
| "Add rules for finance agent" | Read [finance.md](./rules/finance.md) |
| "Add rules for e-commerce agent" | Read [ecommerce.md](./rules/ecommerce.md) |
| "Understand rule syntax" | Read [rules/README.md](./rules/README.md) |
| "What conditions can I use?" | Read [rules/README.md](./rules/README.md) |

### Framework Detection Steps

1. Read `package.json` to check dependencies
2. Search for import patterns (see Quick Framework Detection above)
3. Select the appropriate framework guide
4. Follow the integration steps in that guide

### Rule Generation Steps

1. Identify the agent's domain (healthcare, finance, e-commerce, etc.)
2. If a domain template exists, read it from `rules/`
3. Analyze the agent's tools and categorize them
4. Generate rules following the [rule-generation-workflow.md](./rules/rule-generation-workflow.md)
5. Apply domain-specific patterns from the template

### Key Code References

When implementing, refer to these patterns in the Handlebar codebase:

- **AI SDK wrapper**: `packages/ai-sdk-v5/src/agent.ts`
- **Core engine**: `packages/core/src/engine.ts`
- **Rule types**: `packages/governance-schema/src/rules/`
- **Example**: `examples/ai-sdk-v5/customer-support/`
