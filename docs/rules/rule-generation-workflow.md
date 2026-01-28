# Rule Generation Workflow

This document provides a systematic workflow for generating domain-specific governance rules for any AI agent.

---

## Overview

A complete rule pack should cover **9 control dimensions**:

| Dimension | Code | Description |
|-----------|------|-------------|
| User Tags / Metadata | `UM` | Rules based on user roles, permissions, verification status |
| Tooling | `TL` | Rules governing specific tool usage and authorization |
| Type of Operation | `OP` | Rules based on read/write/delete/transfer semantics |
| Audience | `AU` | Rules based on who receives outputs |
| Input to Tool | `IN` | Rules validating and sanitizing input data |
| Temporal | `TE` | Time-based constraints (hours, booking windows, rate limits) |
| Metrics | `ME` | Aggregated thresholds (capacity, quotas, rates) |
| Execution Time | `EX` | Timeout and latency controls |
| Tool Ordering | `TO` | Sequence and dependency requirements |

---

## Step 1: Analyze the Agent

Before writing rules, gather information about the agent:

### Questions to Answer

```markdown
## Agent Analysis

### 1. Agent Purpose
- What does this agent do?
- What domain does it operate in?
- What problems does it solve?

### 2. Tools Available
| Tool Name | Description | Reads Data? | Writes Data? | External? |
|-----------|-------------|-------------|--------------|-----------|
| | | | | |

### 3. User Types
- Who interacts with this agent?
- What are their roles?
- What permissions should each role have?

### 4. Sensitive Data Handled
- [ ] Customer PII (name, email, phone, address)
- [ ] Financial data (accounts, transactions, cards)
- [ ] Health information (PHI)
- [ ] Credentials/auth tokens
- [ ] Confidential business data
- [ ] Other: _______________

### 5. Regulatory Context
- [ ] GDPR
- [ ] HIPAA
- [ ] PCI-DSS
- [ ] SOX
- [ ] Industry-specific: _______________

### 6. Key Risks
What could go wrong?
- 
- 
- 
```

---

## Step 2: Categorize Tools

Assign categories to each tool. Categories enable rules to target groups of tools.

### Category Taxonomy

```typescript
const CATEGORIES = {
  // Data access
  "read": "Tool reads data",
  "write": "Tool modifies data",
  "delete": "Tool removes data",
  
  // Data sensitivity
  "pii": "Personally identifiable information",
  "phi": "Protected health information (HIPAA)",
  "financial": "Financial/payment data",
  "confidential": "Confidential business data",
  "sensitive": "Generally sensitive data",
  
  // Scope
  "internal": "Internal system access",
  "external": "External API/service call",
  
  // Security
  "auth": "Authentication/authorization related",
  "admin-only": "Requires admin privileges",
  "manager-only": "Requires manager privileges",
  "staff-only": "Internal staff only",
  
  // Risk
  "irreversible": "Action cannot be undone",
  "high-risk": "High business/safety risk",
  
  // Compliance
  "audit-required": "Must be logged for compliance",
  "consent-required": "Requires explicit user consent",
  
  // Workflow
  "escalation": "Triggers human escalation",
  "patient-facing": "Directly affects patient",
  "user-facing": "Directly affects end user",
};
```

### Example Categorization

```typescript
const toolCategories = {
  // Customer support agent
  lookup_customer: ["read", "pii", "internal"],
  update_email: ["write", "pii", "internal", "sensitive"],
  issue_refund: ["write", "financial", "irreversible"],
  delete_account: ["delete", "pii", "irreversible", "admin-only"],
  transfer_to_human: ["escalation"],
  
  // Healthcare agent
  lookup_patient: ["read", "pii", "phi", "internal"],
  book_appointment: ["write", "internal", "patient-facing"],
  send_sms: ["write", "external", "consent-required"],
};
```

---

## Step 3: Generate Rules by Dimension

For each dimension, ask the relevant questions and generate rules.

### User Metadata (UM)

**Questions:**
- What verification is required before actions?
- What roles exist and what can each do?
- Are there any user states that should block access (suspended, unverified)?

**Common patterns:**
```json
// Require verification
{
  "id": "UM-001",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["pii"] } },
  "condition": { "kind": "not", "not": { "kind": "enduserTag", "op": "hasValue", "tag": "verified", "value": "true" } },
  "effect": { "type": "block", "reason": "Please verify your identity first." }
}

// Role-based access
{
  "id": "UM-002",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["admin-only"] } },
  "condition": { "kind": "not", "not": { "kind": "enduserTag", "op": "hasValue", "tag": "role", "value": "admin" } },
  "effect": { "type": "block", "reason": "This action requires admin privileges." }
}
```

### Tooling (TL)

**Questions:**
- Which tools need special authorization?
- Which tools should always be logged?
- Are there tool-specific restrictions?

**Common patterns:**
```json
// Require consent for specific tool
{
  "id": "TL-001",
  "selector": { "phase": "tool.before", "tool": { "name": "send_sms" } },
  "condition": { "kind": "not", "not": { "kind": "enduserTag", "op": "hasValue", "tag": "sms_consent", "value": "true" } },
  "effect": { "type": "block", "reason": "SMS consent not recorded." }
}

// Audit all uses of sensitive tool
{
  "id": "TL-002",
  "selector": { "phase": "tool.after", "tool": { "name": "lookup_nhs_number" } },
  "condition": { "kind": "toolName", "op": "eq", "value": "lookup_nhs_number" },
  "effect": { "type": "allow", "reason": "Access logged for compliance." }
}
```

### Operation Type (OP)

**Questions:**
- Do write operations need confirmation?
- Do delete operations need approval?
- Should reads be unrestricted for verified users?

**Common patterns:**
```json
// Confirm destructive actions
{
  "id": "OP-001",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["irreversible"] } },
  "condition": { "kind": "toolTag", "op": "has", "tag": "irreversible" },
  "effect": { "type": "hitl", "reason": "This action cannot be undone. Please confirm." }
}
```

### Audience (AU)

**Questions:**
- Who can see what data?
- Is there proper data isolation between users?
- Can users access other users' data?

**Common patterns:**
```json
// Data isolation
{
  "id": "AU-001",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["pii"] } },
  "condition": { "kind": "signal", "key": "user.accessingOtherUserData", "op": "eq", "value": true },
  "effect": { "type": "block", "reason": "You can only access your own data." }
}
```

### Input Validation (IN)

**Questions:**
- What input formats should be validated?
- What dangerous patterns should be blocked?
- Are there business rules on input values?

**Common patterns:**
```json
// Format validation
{
  "id": "IN-001",
  "selector": { "phase": "tool.before", "tool": { "name": "lookup_nhs_number" } },
  "condition": { "kind": "signal", "key": "validation.invalidNhsNumber", "op": "eq", "value": true },
  "effect": { "type": "block", "reason": "Please provide a valid 10-digit NHS number." }
}

// Business rule
{
  "id": "IN-002",
  "selector": { "phase": "tool.before", "tool": { "name": "issue_refund" } },
  "condition": { "kind": "signal", "key": "refund.exceedsOrderValue", "op": "eq", "value": true },
  "effect": { "type": "block", "reason": "Refund cannot exceed order value." }
}
```

### Temporal (TE)

**Questions:**
- What are the operating hours?
- Are there minimum lead times?
- Should there be rate limiting?

**Common patterns:**
```json
// Operating hours
{
  "id": "TE-001",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["user-facing"] } },
  "condition": { "kind": "not", "not": { "kind": "timeGate", "windows": [{ "days": ["mon","tue","wed","thu","fri"], "start": "09:00", "end": "17:00" }] } },
  "effect": { "type": "block", "reason": "This service is available Mon-Fri 9am-5pm." }
}

// Rate limiting
{
  "id": "TE-002",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["sensitive"] } },
  "condition": { "kind": "maxCalls", "selector": { "by": "toolTag", "tags": ["sensitive"] }, "max": 5 },
  "effect": { "type": "block", "reason": "Rate limit exceeded. Please wait before trying again." }
}
```

### Metrics (ME)

**Questions:**
- What capacity limits exist?
- What quotas apply?
- What aggregated thresholds should trigger rules?

**Common patterns:**
```json
// Capacity check
{
  "id": "ME-001",
  "selector": { "phase": "tool.before", "tool": { "name": "book_appointment" } },
  "condition": { "kind": "signal", "key": "clinic.atCapacity", "op": "eq", "value": true },
  "effect": { "type": "block", "reason": "No available slots at this time." }
}

// Abuse detection
{
  "id": "ME-002",
  "selector": { "phase": "tool.before", "tool": { "name": "issue_refund" } },
  "condition": { "kind": "signal", "key": "customer.highRefundRate", "op": "eq", "value": true },
  "effect": { "type": "hitl", "reason": "This account requires manager review." }
}
```

### Execution Time (EX)

**Questions:**
- What timeouts are appropriate?
- How should slow responses be handled?

**Common patterns:**
```json
// Timeout handling
{
  "id": "EX-001",
  "selector": { "phase": "tool.after", "tool": { "tagsAny": ["external"] } },
  "condition": { "kind": "executionTime", "scope": "tool", "op": "gt", "ms": 10000 },
  "effect": { "type": "allow", "reason": "Request took longer than expected. Please don't retry." }
}
```

### Tool Ordering (TO)

**Questions:**
- What must happen before sensitive actions?
- What sequences are required?
- What should happen after certain actions?

**Common patterns:**
```json
// Verification before action
{
  "id": "TO-001",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["pii"] } },
  "condition": { "kind": "sequence", "mustHaveCalled": ["verify_identity"] },
  "effect": { "type": "block", "reason": "Please verify your identity first." }
}

// Check before action
{
  "id": "TO-002",
  "selector": { "phase": "tool.before", "tool": { "name": "book_appointment" } },
  "condition": { "kind": "sequence", "mustHaveCalled": ["check_availability"] },
  "effect": { "type": "block", "reason": "Let me check availability first." }
}
```

---

## Step 4: Apply Domain Patterns

Based on the domain, apply relevant patterns:

| Domain | Focus Areas |
|--------|-------------|
| **Healthcare** | Patient safety, emergency escalation, consent, PHI protection, clinical workflows |
| **Finance** | Transaction limits, fraud prevention, strong auth, audit trails, cooling periods |
| **E-commerce** | Refund controls, identity verification, order validation, fraud prevention |
| **HR** | Access control, employee data isolation, approval workflows, audit logging |

See the domain-specific templates:
- [healthcare.md](./healthcare.md)
- [finance.md](./finance.md)
- [ecommerce.md](./ecommerce.md)
- [hr.md](./hr.md)

---

## Step 5: Define Signals and Extractors

Many rules depend on custom signals. Define them based on your rules:

### Identifying Required Signals

Scan your rules for `"kind": "signal"` conditions and list the required signals:

```typescript
// From the rules, identify signals needed:
const requiredSignals = [
  "user.accessingOtherUserData",
  "validation.invalidNhsNumber",
  "refund.exceedsOrderValue",
  "customer.highRefundRate",
  "clinic.atCapacity",
];

// Implement each signal
engine.registerSignal("user.accessingOtherUserData", async (args, { ctx }) => {
  const requestedUserId = args.userId;
  const currentUserId = ctx.enduser?.externalId;
  return requestedUserId && requestedUserId !== currentUserId;
});

engine.registerSignal("validation.invalidNhsNumber", async ({ nhsNumber }) => {
  return !/^[0-9]{10}$/.test(nhsNumber || "");
});
```

### Identifying Subject Extractors

For rules using subjects, define extractors:

```typescript
engine.registerSubjectExtractor("lookup_customer", (args) => [{
  subjectType: "customer",
  role: "primary",
  value: args.toolArgs?.customer_id,
  idSystem: "customer_id",
}]);
```

---

## Step 6: Output the Rule Pack

Structure your final rule pack:

```markdown
# [Agent Name] Rule Pack

## Overview
- Agent purpose
- Tools
- User types
- Sensitive data
- Regulations
- Key risks

## Tool Categories
```typescript
const toolCategories = { ... };
```

## Rules

### 1. User Metadata (UM)
[rules...]

### 2. Tooling (TL)
[rules...]

### 3. Operation Type (OP)
[rules...]

### 4. Audience (AU)
[rules...]

### 5. Input Validation (IN)
[rules...]

### 6. Temporal (TE)
[rules...]

### 7. Metrics (ME)
[rules...]

### 8. Execution Time (EX)
[rules...]

### 9. Tool Ordering (TO)
[rules...]

## Required Signals
```typescript
engine.registerSignal(...);
```

## Subject Extractors
```typescript
engine.registerSubjectExtractor(...);
```
```

---

## Rule ID Conventions

Use consistent rule IDs:

```
{DOMAIN}-{DIMENSION}-{NUMBER}

Examples:
- HC-UM-001  (Healthcare, User Metadata, rule 1)
- FIN-TO-003 (Finance, Tool Ordering, rule 3)
- ECOM-IN-002 (E-commerce, Input validation, rule 2)
```

---

## Checklist

Before finalizing the rule pack:

- [ ] All 9 dimensions considered
- [ ] Rules have unique IDs
- [ ] Rules have user-friendly messages
- [ ] Priorities are set appropriately (higher = evaluated first)
- [ ] Required signals are documented
- [ ] Subject extractors are defined
- [ ] Tool categories are complete
- [ ] Rules tested in monitor mode first
