---
name: handlebar
description: Connect an AI agent to Handlebar governance platform
---

# Handlebar Connection Skill

Connect an AI agent to the Handlebar governance platform. This skill analyzes the agent codebase and prepares the information needed to configure governance in Handlebar.

## When to Use

Use this skill when the user wants to:
- Connect an agent to Handlebar
- Set up Handlebar governance
- Onboard an agent to Handlebar

## Workflow

### Step 1: Handlebar Setup Information

**INFORM THE USER**:

> "To connect your agent to Handlebar, you'll need an account and API key:
>
> **Sign up**: https://app.gethandlebar.com  
> (Handlebar is currently operating a waitlist - if you don't have access, email contact@gethandlebar.com to request it)
>
> **Create an API key**: Org Settings > API Keys > Create API key
>
> **Set the environment variable**:
> ```bash
> export HANDLEBAR_API_KEY=hb_your_api_key_here
> # Or add to .env file
> HANDLEBAR_API_KEY=hb_your_api_key_here
> ```
>
> Don't worry if you don't have this yet - the API key can be added after we've onboarded your agent. Let's continue with the setup."

Proceed to Step 2.

### Step 2: Detect Agent Framework

Search the codebase for framework indicators:

| Framework | Detection Pattern | Package |
|-----------|-------------------|---------|
| **Vercel AI SDK v5+** | `"ai": "^5.x"` or `import { Agent } from "ai"` | `@handlebar/ai-sdk-v5` |
| **LangChain JS** | `"@langchain/core"` or `import { AgentExecutor }` | `@handlebar/core` |
| **LlamaIndex TS** | `"llamaindex"` or `import { FunctionTool }` | `@handlebar/core` |
| **OpenAI SDK** | `"openai"` with tool calls | `@handlebar/core` |
| **Anthropic SDK** | `"@anthropic-ai/sdk"` with tool_use | `@handlebar/core` |
| **Google Gemini** | `"@google/generative-ai"` | `@handlebar/core` |
| **Custom** | Manual agent loop | `@handlebar/core` |

**Output**: Report the detected framework to the user.

### Step 3: Configure Framework on Handlebar

Based on detected framework, provide integration instructions.

---

#### For Vercel AI SDK v5+

**Package**: `@handlebar/ai-sdk-v5`  
**Compatibility**: `ai@^5.0.0` (may work with `^6.0.0`)

Handlebar has first-class support for Vercel AI SDK. The `HandlebarAgent` class is a **drop-in replacement** for `Experimental_Agent` (or `Agent` in v6).

**What it does automatically:**
- Loads relevant rulesets from the Handlebar API
- Evaluates rules against agent actions client-side
- Emits audit event logs to the Handlebar API

**Installation:**

```bash
npm install @handlebar/ai-sdk-v5 @handlebar/core
```

**Basic integration (drop-in replacement):**

```diff
- import { Experimental_Agent as Agent } from 'ai';
+ import { HandlebarAgent } from '@handlebar/ai-sdk-v5';

- const agent = new Agent({
+ const agent = new HandlebarAgent({
  system,
  model,
  tools,
});

const result = await agent.generate({ prompt: "Help me with my order" });
```

**With agent identity (recommended):**

Providing an agent identity gives Handlebar useful context. Without a `slug`, Handlebar generates one based on the agent's PWD.

```typescript
import { HandlebarAgent } from '@handlebar/ai-sdk-v5';

const agent = new HandlebarAgent({
  system,
  model,
  tools,
  agent: {
    slug: "customer-support",           // Unique identifier
    name: "Customer Support Agent",     // Human-readable name
    description: "Handles customer inquiries and refunds",
    tags: ["customer-facing", "payments", "prod", "eu"],  // For grouping in Handlebar
  },
});
```

**With enduser identity (for per-user rules):**

Pass enduser info to enable rules based on user attributes or behaviour (e.g., rate limits per user, role-based access).

```typescript
const result = await agent.generate(
  { prompt: "Help me with my refund" },
  {
    enduser: {
      externalId: "user-123",           // Your system's user ID
      name: "Alice Smith",
      metadata: { role: "premium", region: "eu" },
      group: {                          // Optional: user's organisation
        externalId: "org-456",
        name: "Acme Corp",
        metadata: { plan: "enterprise" },
      },
    },
  }
);
```

---

#### For All Other Frameworks (LangChain, LlamaIndex, OpenAI SDK, etc.)

**Package**: `@handlebar/core`  
**Compatibility**: Framework-agnostic

Use `GovernanceEngine` directly to integrate Handlebar into any agent framework.

**What it does:**
- Runtime rule evaluation engine
- Communicates with Handlebar API (fetch rules, update agent identity)
- Emits audit event logs to Handlebar API

**Installation:**

```bash
npm install @handlebar/core
```

**Environment variables:**

```bash
HANDLEBAR_API_KEY=hb_your_api_key_here
```

If `HANDLEBAR_API_KEY` is set, audit logs go to Handlebar API. Otherwise, they log to console.

**Integration steps:**

**1. Initialise the engine and configure agent rules:**

```typescript
import { GovernanceEngine } from "@handlebar/core";

const engine = new GovernanceEngine();

// Configure agent identity and tools (call once during agent init)
await engine.initAgentRules(
  {
    slug: "customer-support",
    name: "Customer Support Agent",
    description: "Handles customer inquiries",
    tags: ["customer-facing", "prod"],
  },
  [
    // Tools the agent has access to
    {
      name: "getUserProfile",
      key: "getUserProfile",
      version: 1,
      kind: "function",
      description: "Fetches user profile data",
      metadata: { category: "pii" },
    },
    {
      name: "issueRefund",
      key: "issueRefund", 
      version: 1,
      kind: "function",
      description: "Issues a refund to customer",
      metadata: { category: "financial" },
    },
  ]
);
```

**2. Create a run context for each session:**

```typescript
// Create context for this agent run (with optional enduser)
const runCtx = engine.createRunContext(
  "run-" + crypto.randomUUID(),
  {
    enduser: {
      externalId: "user-123",
      name: "Alice Smith",
      metadata: { role: "premium" },
      group: {
        externalId: "org-456",
        name: "Acme Corp",
      },
    },
  }
);
```

**3. Wrap tool execution with governance checks:**

```typescript
async function executeToolWithGovernance(toolName: string, args: unknown) {
  // BEFORE: Evaluate rules and emit tool.decision event
  const decision = await engine.beforeTool(runCtx, toolName, args);
  
  if (decision.effect === "block") {
    return { blocked: true, reason: decision.reason };
  }
  
  if (decision.effect === "hitl") {
    // Handle HITL approval flow
    return { requiresApproval: true, reason: decision.reason };
  }
  
  // EXECUTE: Run the actual tool
  const startTime = Date.now();
  let result: unknown;
  let error: unknown;
  
  try {
    result = await actualToolImplementation(toolName, args);
  } catch (e) {
    error = e;
  }
  
  // AFTER: Evaluate post-execution rules and emit tool.result event
  await engine.afterTool(
    runCtx,
    toolName,
    Date.now() - startTime,  // execution time in ms
    args,
    result,
    error
  );
  
  if (error) throw error;
  return result;
}
```

**Output**: Provide the appropriate code snippet for the detected framework.

---

#### For Non-JavaScript/TypeScript Agents

If the agent is built in a language other than JavaScript or TypeScript (e.g., Python, Go, Rust, Java):

**INFORM THE USER**:

> "[Language] is not yet supported by Handlebar SDKs.
>
> Please contact the Handlebar team at contact@gethandlebar.com to let them know the agent framework you want to use. We will endeavour to support it as soon as possible.
>
> In the meantime, let's continue with the agent and rule analysis so you're ready when support is available."

Then proceed to Step 4 to complete the codebase assessment.

---

### Step 4: Assess Codebase for Agent Purpose

Analyze the agent to gather information for Handlebar configuration.

#### 4.i: Tool Analysis

For each tool in the agent, extract:

1. **Tool name**
2. **Description** - What does it do?
3. **Summary** - One-line purpose
4. **Suggested categories** from:
   - Data: `read`, `write`, `delete`
   - Sensitivity: `pii`, `phi`, `financial`, `sensitive`
   - Scope: `internal`, `external`
   - Risk: `irreversible`, `high-risk`
   - Auth: `auth`, `admin-only`, `manager-only`

**Output format**:

```
## Tool Analysis

| Tool | Summary | Categories |
|------|---------|------------|
| getUserProfile | Fetches user profile data | read, pii, internal |
| issueRefund | Processes customer refunds | write, financial, irreversible |
| sendEmail | Sends email to customer | write, external |
```

#### 4.ii: Agent Intent & Workflow

Based on the tool analysis above, determine what the agent is trying to accomplish:

**Analyze:**

1. **Primary workflow** - What business process does this agent support?
   - Look at the combination of tools and how they would be used together
   - Consider the system prompt if available
   - Example: "Patient appointment booking and management"

2. **Agent goal** - What is the agent ultimately trying to achieve for the user?
   - Example: "Help patients book, reschedule, or cancel appointments"

3. **Workflow stages** - What steps does the agent typically take?
   - Example: "1. Verify patient identity → 2. Check availability → 3. Book appointment → 4. Send confirmation"

4. **Domain** - What industry/sector does this agent operate in?
   - Healthcare, Finance, E-commerce, HR, Legal, Customer Support, etc.

**Output format**:

```
## Agent Intent & Workflow

**Domain**: Healthcare

**Primary workflow**: Patient appointment management

**Agent goal**: Help patients book, modify, and cancel appointments with their healthcare provider

**Typical workflow**:
1. Verify patient identity (lookup_patient, verify_dob)
2. Understand patient need (conversation)
3. Check availability (check_slots)
4. Book/modify/cancel appointment (book_appointment, cancel_appointment)
5. Send confirmation (send_confirmation_sms, send_confirmation_email)

**Key interactions**:
- Patient ↔ Agent: Conversational booking
- Agent ↔ Clinical system: Appointment CRUD
- Agent ↔ Patient: Notifications
```

#### 4.iii: Jurisdiction & User Impact

Look for indicators in the codebase:

**Jurisdiction signals:**
- Regulatory references: `NHS`, `HIPAA`, `GDPR`, `FCA`, `PCI-DSS`
- Domain suffixes: `.nhs.uk`, `.gov`, `.eu`
- Currency: `£` (UK), `$` (US), `€` (EU)
- Phone formats: `+44` (UK), `+1` (US)
- ID formats: NHS number, SSN, national ID patterns

**User impact signals:**
- User types: patients, customers, employees, public
- Data sensitivity: health records, financial data, personal info
- Action severity: payments, deletions, account changes

**Output format**:

```
## Jurisdiction & User Impact

**Detected jurisdiction**: UK (NHS references, £ currency, +44 phone format)

**Users impacted**: Patients

**Data sensitivity**: 
- PHI (health records)
- PII (contact details)

**Regulatory considerations**:
- UK GDPR
- NHS Data Security and Protection Toolkit
- Caldicott Principles

**High-risk actions**:
- Book/cancel appointments (affects patient care)
- Access medical records (PHI exposure)
```

If jurisdiction cannot be inferred, **ASK THE USER**:

> "I couldn't determine the jurisdiction from the codebase. Where will this agent operate?
> - UK
> - US  
> - EU
> - Other (please specify)"

### Final Output

Provide a summary report for Handlebar configuration and **save it to a file** for use by the rule generation skill.

**Create `.handlebar` folder and save to `.handlebar/agent-config.json`**:

```json
{
  "agent": {
    "slug": "[agent-slug]",
    "name": "[agent-name]",
    "framework": "[detected framework]",
    "package": "[package to install]"
  },
  "tools": [
    { "name": "toolName", "summary": "...", "categories": ["read", "pii"] }
  ],
  "intent": {
    "domain": "[healthcare/finance/etc.]",
    "workflow": "[primary workflow]",
    "goal": "[agent goal]"
  },
  "context": {
    "jurisdiction": "[UK/US/EU]",
    "users": "[who is impacted]",
    "regulations": ["regulation1", "regulation2"],
    "highRiskActions": ["action1", "action2"]
  }
}
```

**Output to user**:

```
# Handlebar Configuration Summary

## Agent
- **Framework**: [detected framework]
- **Package**: [package to install]

## Tools
| Tool | Summary | Categories |
|------|---------|------------|
| ... | ... | ... |

## Intent
- **Domain**: [domain]
- **Workflow**: [primary workflow]
- **Goal**: [agent goal]

## Context
- **Jurisdiction**: [detected/specified]
- **Users**: [who is impacted]
- **Regulations**: [applicable regulations]
- **High-risk actions**: [list]

## Next Steps
1. Install the package: `npm install [package]`
2. Add the integration code (above)
3. Run `/handlebar_rule_generation` to generate governance rules

---

Configuration saved to `.handlebar/agent-config.json`
```

**ASK THE USER**:

> "Please review the configuration above. Is this information correct?
>
> - If yes, you can proceed with `/handlebar_rule_generation` to generate governance rules
> - If anything needs to be changed, let me know and I'll update the configuration"
