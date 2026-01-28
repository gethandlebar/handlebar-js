# Handlebar Governance Rules Reference

This document provides a complete reference for Handlebar governance rule structure, conditions, and effects.

---

## Rule Structure

```json
{
  "id": "unique-rule-id",
  "enabled": true,
  "priority": 100,
  "name": "Human-readable rule name",
  "selector": {
    "phase": "tool.before",
    "tool": { "tagsAny": ["pii"] }
  },
  "condition": {
    "kind": "sequence",
    "mustHaveCalled": ["verifyIdentity"]
  },
  "effect": {
    "type": "block",
    "reason": "User-facing message explaining why the action was blocked."
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the rule |
| `enabled` | boolean | Whether the rule is active |
| `priority` | number | Higher priority rules are evaluated first |
| `name` | string | Human-readable description |
| `selector` | object | When this rule applies (phase + tool matching) |
| `condition` | object | What triggers the rule effect |
| `effect` | object | What happens when condition matches |

---

## Rule Selectors

Selectors determine which tool calls a rule applies to.

### Phase

| Phase | When Evaluated |
|-------|----------------|
| `tool.before` | Before the tool executes |
| `tool.after` | After the tool completes |

### Tool Matching

```jsonc
// Match by exact tool name
{ "phase": "tool.before", "tool": { "name": "issueRefund" } }

// Match by glob pattern
{ "phase": "tool.before", "tool": { "name": "get*" } }

// Match tools with ANY of these tags
{ "phase": "tool.before", "tool": { "tagsAny": ["pii", "sensitive"] } }

// Match tools with ALL of these tags
{ "phase": "tool.before", "tool": { "tagsAll": ["write", "external"] } }

// Match all tools
{ "phase": "tool.before", "tool": { "name": "*" } }

// Match all tools (no tool filter)
{ "phase": "tool.before" }
```

---

## Condition Types

### toolName

Match by tool name.

```json
{ "kind": "toolName", "op": "eq", "value": "issueRefund" }
{ "kind": "toolName", "op": "neq", "value": "readOnly" }
{ "kind": "toolName", "op": "contains", "value": "refund" }
{ "kind": "toolName", "op": "startsWith", "value": "get" }
{ "kind": "toolName", "op": "endsWith", "value": "Record" }
{ "kind": "toolName", "op": "glob", "value": "user*" }
{ "kind": "toolName", "op": "in", "value": ["tool1", "tool2", "tool3"] }
```

### toolTag

Match by tool category tag.

```json
{ "kind": "toolTag", "op": "has", "tag": "pii" }
{ "kind": "toolTag", "op": "anyOf", "tags": ["pii", "financial"] }
{ "kind": "toolTag", "op": "allOf", "tags": ["write", "external"] }
```

### enduserTag

Match by end user metadata.

```json
{ "kind": "enduserTag", "op": "has", "tag": "verified" }
{ "kind": "enduserTag", "op": "hasValue", "tag": "role", "value": "admin" }
{ "kind": "enduserTag", "op": "hasValueAny", "tag": "role", "values": ["admin", "manager"] }
```

### sequence

Check tool call history.

```json
// Block if verifyIdentity has NOT been called
{ "kind": "sequence", "mustHaveCalled": ["verifyIdentity"] }

// Block if deleteRecord HAS been called
{ "kind": "sequence", "mustNotHaveCalled": ["deleteRecord"] }

// Combine both
{
  "kind": "sequence",
  "mustHaveCalled": ["verifyIdentity"],
  "mustNotHaveCalled": ["deleteRecord"]
}
```

### maxCalls

Limit number of tool calls.

```json
// Max 5 calls to issueRefund
{
  "kind": "maxCalls",
  "selector": { "by": "toolName", "patterns": ["issueRefund"] },
  "max": 5
}

// Max 10 calls to any tool tagged "sensitive"
{
  "kind": "maxCalls",
  "selector": { "by": "toolTag", "tags": ["sensitive"] },
  "max": 10
}
```

### executionTime

Check tool or run duration.

```json
// Tool took more than 5 seconds
{ "kind": "executionTime", "scope": "tool", "op": "gt", "ms": 5000 }

// Total run time exceeds 60 seconds
{ "kind": "executionTime", "scope": "run", "op": "gt", "ms": 60000 }
```

Operators: `gt`, `gte`, `lt`, `lte`, `eq`, `neq`

### timeGate

Time-of-day restrictions.

```json
{
  "kind": "timeGate",
  "windows": [
    { "days": ["mon", "tue", "wed", "thu", "fri"], "start": "09:00", "end": "17:00" }
  ],
  "timezone": { "source": "enduserTag", "tag": "timezone" }
}
```

Days: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`

### signal

Custom signal evaluation. Signals are registered via `engine.registerSignal()`.

```json
{
  "kind": "signal",
  "key": "crm.isVIP",
  "args": {
    "customerId": { "from": "subject", "subjectType": "customer", "field": "id" }
  },
  "op": "eq",
  "value": true
}
```

Signal args can pull from:
- `{ "from": "toolArg", "path": "amount" }` - Tool input arguments
- `{ "from": "subject", "subjectType": "customer", "field": "id" }` - Extracted subjects
- `{ "from": "const", "value": 100 }` - Constant values

### requireSubject

Require a subject to be extracted.

```json
{ "kind": "requireSubject", "subjectType": "customer" }
{ "kind": "requireSubject", "subjectType": "customer", "role": "primary" }
{ "kind": "requireSubject", "subjectType": "customer", "idSystem": "crm_id" }
```

### Logical Combinators

#### and

All conditions must match.

```json
{
  "kind": "and",
  "all": [
    { "kind": "toolTag", "op": "has", "tag": "pii" },
    { "kind": "enduserTag", "op": "hasValue", "tag": "verified", "value": "false" }
  ]
}
```

#### or

Any condition must match.

```json
{
  "kind": "or",
  "any": [
    { "kind": "toolName", "op": "eq", "value": "deleteAccount" },
    { "kind": "toolTag", "op": "has", "tag": "irreversible" }
  ]
}
```

#### not

Negate a condition.

```json
{
  "kind": "not",
  "not": { "kind": "enduserTag", "op": "hasValue", "tag": "role", "value": "admin" }
}
```

---

## Effect Types

| Effect | Behavior |
|--------|----------|
| `allow` | Permit the tool call (with optional logging) |
| `block` | Deny the tool call |
| `hitl` | Request human-in-the-loop approval |

### Effect Structure

```json
{
  "type": "block",
  "reason": "User-facing message explaining why."
}
```

The `reason` field is returned to the LLM and can be shown to the user.

---

## Rule Outcomes (Extended)

For domain-specific rule packs, these extended outcomes can be used:

| Outcome | Maps To | Behavior |
|---------|---------|----------|
| `ALLOW` | `allow` | Proceed with optional logging |
| `DENY` | `block` | Block completely with message |
| `REQUIRE explicit_user_approval` | `hitl` | Pause, ask user, await confirmation |
| `ENFORCE` | `allow` + side effect | Apply constraint (logging, instructions) |
| `TIMEOUT` | `block` | Abort if execution time exceeded |
| `ESCALATE` | `hitl` | Route to human (staff, manager, specialist) |
| `QUEUE` | Custom | Hold for execution when conditions are met |

---

## Tool Categories

Common category taxonomy for categorizing tools:

```typescript
const CATEGORY_TAXONOMY = {
  // Data access
  "read": "Tool reads data",
  "write": "Tool modifies data",
  "delete": "Tool deletes data",
  
  // Data sensitivity
  "pii": "Personally identifiable information",
  "phi": "Protected health information",
  "financial": "Financial/payment data",
  "confidential": "Confidential business data",
  "sensitive": "Generally sensitive data",
  
  // Scope
  "internal": "Internal system access",
  "external": "External API/service call",
  
  // Security
  "auth": "Authentication/authorization",
  "admin-only": "Requires admin privileges",
  "manager-only": "Requires manager privileges",
  "staff-only": "Internal staff only",
  
  // Risk
  "irreversible": "Cannot be undone",
  "high-risk": "High business risk",
  
  // Compliance
  "audit-required": "Must be logged for compliance",
  "consent-required": "Requires user consent",
  
  // Workflow
  "escalation": "Escalates to human",
  "patient-facing": "Directly affects patient",
  "user-facing": "Directly affects end user",
};
```

---

## Example: Complete Rule

```json
{
  "id": "PII-001",
  "enabled": true,
  "priority": 100,
  "name": "Require verification before PII access",
  "selector": {
    "phase": "tool.before",
    "tool": { "tagsAny": ["pii"] }
  },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "enduserTag", "op": "hasValue", "tag": "type", "value": "customer" },
      { "kind": "sequence", "mustHaveCalled": ["verifyIdentity"] }
    ]
  },
  "effect": {
    "type": "block",
    "reason": "Please verify your identity before accessing personal information."
  }
}
```

---

## Advanced Features

### Custom Metrics

Register metrics to track during tool execution:

```typescript
import type { AgentMetricHook } from "@handlebar/core";

const metric: AgentMetricHook<"tool.after"> = {
  phase: "tool.after",
  key: "refund_amount",
  run: async ({ toolName, result }) => {
    if (toolName !== "issueRefund") return;
    return { value: result.amount, unit: "USD" };
  },
};

engine.registerMetric(metric);
```

### Subject Extractors

Extract entities from tool calls for use in rules:

```typescript
engine.registerSubjectExtractor("getUserProfile", (args) => [{
  subjectType: "customer",
  role: "primary",
  value: args.toolArgs.userId,
  idSystem: "crm_id",
}]);
```

### Custom Signals

Register custom logic that rules can evaluate:

```typescript
engine.registerSignal("crm.isVIP", async (args) => {
  const { customerId } = args;
  const customer = await db.findCustomer(customerId);
  return customer?.tier === "vip";
});
```
