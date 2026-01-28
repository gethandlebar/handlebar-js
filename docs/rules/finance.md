# Financial Services Rule Template

Rule pack template for agents handling transactions, account management, and financial services.

---

## Domain Context

### Typical Agent Functions
- Account balance and transaction queries
- Fund transfers and payments
- Account management (contact details, PIN changes)
- Transaction disputes
- Statement requests

### User Types
- Individual customers (external)
- Business account holders (external)
- Customer service staff (internal)
- Fraud team (internal)
- Compliance officers (internal)

### Sensitive Data
- Account numbers and balances
- Transaction history
- Customer PII
- Payment card details
- Bank routing information

### Regulatory Context
- PCI-DSS (Payment Card Industry)
- SOX (Sarbanes-Oxley)
- FCA regulations (UK)
- AML/KYC requirements
- GDPR / Data Protection

### Key Risks
- Unauthorized fund transfers
- Fraud and social engineering
- Money laundering
- Data breaches
- Regulatory non-compliance
- Account takeover

---

## Tool Categories

```typescript
const financeCategories: Record<string, string[]> = {
  // Account access
  get_account_balance: ["read", "pii", "financial", "internal"],
  get_transaction_history: ["read", "pii", "financial", "internal"],
  get_account_details: ["read", "pii", "financial", "internal"],
  
  // Transactions
  transfer_funds: ["write", "financial", "irreversible", "high-risk"],
  pay_bill: ["write", "financial", "external"],
  setup_standing_order: ["write", "financial", "recurring"],
  cancel_standing_order: ["write", "financial"],
  
  // Account management
  update_contact_details: ["write", "pii", "internal"],
  change_pin: ["write", "auth", "sensitive", "irreversible"],
  change_password: ["write", "auth", "sensitive"],
  add_beneficiary: ["write", "financial", "setup"],
  remove_beneficiary: ["write", "financial"],
  
  // Support
  dispute_transaction: ["write", "financial", "escalation"],
  request_statement: ["read", "pii", "external"],
  report_fraud: ["write", "escalation", "urgent"],
  
  // Verification
  verify_identity: ["auth", "internal"],
  send_otp: ["auth", "external"],
  verify_otp: ["auth", "internal"],
};
```

---

## Rule Pack

### 1. User Tags / Metadata (UM)

#### UM-001: Strong Authentication Required

```json
{
  "id": "FIN-UM-001",
  "enabled": true,
  "priority": 100,
  "name": "Strong Authentication Required",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["financial", "pii"] } },
  "condition": {
    "kind": "not",
    "not": { "kind": "enduserTag", "op": "hasValue", "tag": "auth_level", "value": "strong" }
  },
  "effect": { "type": "block", "reason": "Please complete two-factor authentication to continue." }
}
```

#### UM-002: Step-Up Auth for High-Risk Actions

```json
{
  "id": "FIN-UM-002",
  "enabled": true,
  "priority": 95,
  "name": "Step-Up Authentication for High-Risk",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["high-risk", "irreversible"] } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "enduserTag", "op": "hasValue", "tag": "auth_level", "value": "strong" },
      { "kind": "not", "not": { "kind": "enduserTag", "op": "hasValue", "tag": "step_up_verified", "value": "true" } }
    ]
  },
  "effect": { "type": "hitl", "reason": "For your security, please confirm this action with a one-time code sent to your registered mobile." }
}
```

#### UM-003: Fraud Team Override

```json
{
  "id": "FIN-UM-003",
  "enabled": true,
  "priority": 200,
  "name": "Fraud Team Override Privileges",
  "selector": { "phase": "tool.before" },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "enduserTag", "op": "hasValue", "tag": "role", "value": "fraud_team" },
      { "kind": "enduserTag", "op": "hasValue", "tag": "authenticated", "value": "true" }
    ]
  },
  "effect": { "type": "allow", "reason": "Fraud team action permitted." }
}
```

#### UM-004: Account Frozen Check

```json
{
  "id": "FIN-UM-004",
  "enabled": true,
  "priority": 150,
  "name": "Account Frozen Check",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["financial"] } },
  "condition": { "kind": "enduserTag", "op": "hasValue", "tag": "account_status", "value": "frozen" },
  "effect": { "type": "block", "reason": "Your account is currently frozen. Please contact our support team for assistance." }
}
```

---

### 2. Tooling (TL)

#### TL-001: Transfer Requires Beneficiary Setup

```json
{
  "id": "FIN-TL-001",
  "enabled": true,
  "priority": 85,
  "name": "Transfer Requires Beneficiary Setup",
  "selector": { "phase": "tool.before", "tool": { "name": "transfer_funds" } },
  "condition": {
    "kind": "signal",
    "key": "beneficiary.isNotSetup",
    "args": { "accountNumber": { "from": "toolArg", "path": "recipient_account" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "This recipient is not in your saved beneficiaries. Please add them first for security purposes. New beneficiaries have a 24-hour cooling period before transfers are enabled." }
}
```

#### TL-002: New Beneficiary Cooling Period

```json
{
  "id": "FIN-TL-002",
  "enabled": true,
  "priority": 90,
  "name": "New Beneficiary Cooling Period",
  "selector": { "phase": "tool.before", "tool": { "name": "transfer_funds" } },
  "condition": {
    "kind": "signal",
    "key": "beneficiary.isInCoolingPeriod",
    "args": { "accountNumber": { "from": "toolArg", "path": "recipient_account" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "This beneficiary was added recently. For your security, transfers to new beneficiaries are enabled 24 hours after setup." }
}
```

#### TL-003: Fraud Report Escalation

```json
{
  "id": "FIN-TL-003",
  "enabled": true,
  "priority": 200,
  "name": "Fraud Report Immediate Escalation",
  "selector": { "phase": "tool.before", "tool": { "name": "report_fraud" } },
  "condition": { "kind": "toolName", "op": "eq", "value": "report_fraud" },
  "effect": { "type": "allow", "reason": "Connecting you to our fraud team immediately. Your account will be secured while we investigate." }
}
```

#### TL-004: Audit All Financial Operations

```json
{
  "id": "FIN-TL-004",
  "enabled": true,
  "priority": 50,
  "name": "Audit All Financial Operations",
  "selector": { "phase": "tool.after", "tool": { "tagsAny": ["financial"] } },
  "condition": { "kind": "toolTag", "op": "has", "tag": "financial" },
  "effect": { "type": "allow", "reason": "Transaction logged for compliance and audit purposes." }
}
```

---

### 3. Input Validation (IN)

#### IN-001: Transfer Amount Limit

```json
{
  "id": "FIN-IN-001",
  "enabled": true,
  "priority": 80,
  "name": "Single Transfer Amount Limit",
  "selector": { "phase": "tool.before", "tool": { "name": "transfer_funds" } },
  "condition": {
    "kind": "signal",
    "key": "transaction.exceedsSingleLimit",
    "args": { 
      "amount": { "from": "toolArg", "path": "amount" },
      "currency": { "from": "toolArg", "path": "currency" }
    },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "hitl", "reason": "This transfer exceeds your single transaction limit. Additional verification is required." }
}
```

#### IN-002: Daily Transfer Limit

```json
{
  "id": "FIN-IN-002",
  "enabled": true,
  "priority": 85,
  "name": "Daily Transfer Limit Check",
  "selector": { "phase": "tool.before", "tool": { "name": "transfer_funds" } },
  "condition": {
    "kind": "signal",
    "key": "transaction.exceedsDailyLimit",
    "args": { 
      "amount": { "from": "toolArg", "path": "amount" },
      "customerId": { "from": "subject", "subjectType": "customer", "field": "id" }
    },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "This transfer would exceed your daily limit of £10,000. Please contact us to request a temporary limit increase." }
}
```

#### IN-003: International Transfer Warning

```json
{
  "id": "FIN-IN-003",
  "enabled": true,
  "priority": 75,
  "name": "International Transfer Warning",
  "selector": { "phase": "tool.before", "tool": { "name": "transfer_funds" } },
  "condition": {
    "kind": "signal",
    "key": "transaction.isInternational",
    "args": { "recipientAccount": { "from": "toolArg", "path": "recipient_account" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "hitl", "reason": "You're about to make an international transfer. Exchange rates and fees will apply. Please confirm you wish to proceed." }
}
```

#### IN-004: Unusual Amount Pattern

```json
{
  "id": "FIN-IN-004",
  "enabled": true,
  "priority": 90,
  "name": "Unusual Amount Pattern Detection",
  "selector": { "phase": "tool.before", "tool": { "name": "transfer_funds" } },
  "condition": {
    "kind": "signal",
    "key": "fraud.unusualAmountPattern",
    "args": { 
      "amount": { "from": "toolArg", "path": "amount" },
      "customerId": { "from": "subject", "subjectType": "customer", "field": "id" }
    },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "hitl", "reason": "This transaction is unusual for your account. For your security, please confirm this is a genuine request." }
}
```

#### IN-005: Account Number Validation

```json
{
  "id": "FIN-IN-005",
  "enabled": true,
  "priority": 60,
  "name": "Account Number Validation",
  "selector": { "phase": "tool.before", "tool": { "name": "transfer_funds" } },
  "condition": {
    "kind": "signal",
    "key": "validation.invalidAccountNumber",
    "args": { "accountNumber": { "from": "toolArg", "path": "recipient_account" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "Please check the account number format. UK accounts should be 8 digits with a 6-digit sort code." }
}
```

---

### 4. Temporal (TE)

#### TE-001: Rate Limiting Transfers

```json
{
  "id": "FIN-TE-001",
  "enabled": true,
  "priority": 70,
  "name": "Transfer Rate Limiting",
  "selector": { "phase": "tool.before", "tool": { "name": "transfer_funds" } },
  "condition": { "kind": "maxCalls", "selector": { "by": "toolName", "patterns": ["transfer_funds"] }, "max": 5 },
  "effect": { "type": "block", "reason": "You've reached the maximum number of transfers for this session. Please wait or contact us if you need to make additional transfers." }
}
```

#### TE-002: Out of Hours Large Transfers

```json
{
  "id": "FIN-TE-002",
  "enabled": true,
  "priority": 75,
  "name": "Out of Hours Large Transfer Restriction",
  "selector": { "phase": "tool.before", "tool": { "name": "transfer_funds" } },
  "condition": {
    "kind": "and",
    "all": [
      {
        "kind": "not",
        "not": { "kind": "timeGate", "windows": [{ "days": ["mon", "tue", "wed", "thu", "fri"], "start": "08:00", "end": "20:00" }] }
      },
      {
        "kind": "signal",
        "key": "transaction.isLarge",
        "args": { "amount": { "from": "toolArg", "path": "amount" }, "threshold": { "from": "const", "value": 5000 } },
        "op": "eq",
        "value": true
      }
    ]
  },
  "effect": { "type": "block", "reason": "Large transfers over £5,000 are restricted outside business hours (8am-8pm Mon-Fri). This helps protect your account from fraud." }
}
```

#### TE-003: Session Timeout

```json
{
  "id": "FIN-TE-003",
  "enabled": true,
  "priority": 40,
  "name": "Session Timeout Warning",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["financial"] } },
  "condition": {
    "kind": "signal",
    "key": "session.nearingTimeout",
    "args": { "warningMinutes": { "from": "const", "value": 2 } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "hitl", "reason": "Your session will expire soon for security. Would you like to extend it?" }
}
```

---

### 5. Tool Ordering (TO)

#### TO-001: Verify Before Any Financial Action

```json
{
  "id": "FIN-TO-001",
  "enabled": true,
  "priority": 100,
  "name": "Identity Verification Before Financial Actions",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["financial"] } },
  "condition": { "kind": "sequence", "mustHaveCalled": ["verify_identity"] },
  "effect": { "type": "block", "reason": "Please verify your identity before proceeding with this transaction." }
}
```

#### TO-002: OTP Before High-Risk Actions

```json
{
  "id": "FIN-TO-002",
  "enabled": true,
  "priority": 95,
  "name": "OTP Required for High-Risk Actions",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["high-risk"] } },
  "condition": { "kind": "sequence", "mustHaveCalled": ["send_otp", "verify_otp"] },
  "effect": { "type": "block", "reason": "A one-time code is required for this action. Let me send one to your registered mobile." }
}
```

#### TO-003: Confirmation Before Irreversible Actions

```json
{
  "id": "FIN-TO-003",
  "enabled": true,
  "priority": 90,
  "name": "Confirmation Before Irreversible Actions",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["irreversible"] } },
  "condition": { "kind": "toolTag", "op": "has", "tag": "irreversible" },
  "effect": { "type": "hitl", "reason": "This action cannot be undone. Please confirm you wish to proceed." }
}
```

---

### 6. Metrics (ME)

#### ME-001: Daily Volume Limit

```json
{
  "id": "FIN-ME-001",
  "enabled": true,
  "priority": 85,
  "name": "Daily Transfer Volume Limit",
  "selector": { "phase": "tool.before", "tool": { "name": "transfer_funds" } },
  "condition": {
    "kind": "signal",
    "key": "account.dailyVolumeExceeded",
    "args": { "customerId": { "from": "subject", "subjectType": "customer", "field": "id" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "You've reached your daily transfer volume limit. This resets at midnight or you can contact us for a temporary increase." }
}
```

#### ME-002: Failed Verification Lockout

```json
{
  "id": "FIN-ME-002",
  "enabled": true,
  "priority": 100,
  "name": "Failed Verification Lockout",
  "selector": { "phase": "tool.before", "tool": { "name": "verify_identity" } },
  "condition": { "kind": "maxCalls", "selector": { "by": "toolName", "patterns": ["verify_identity"] }, "max": 3 },
  "effect": { "type": "block", "reason": "Too many verification attempts. Your account has been temporarily locked for security. Please contact us to unlock it." }
}
```

---

### 7. Execution Time (EX)

#### EX-001: Transaction Timeout

```json
{
  "id": "FIN-EX-001",
  "enabled": true,
  "priority": 30,
  "name": "Transaction Processing Timeout",
  "selector": { "phase": "tool.after", "tool": { "name": "transfer_funds" } },
  "condition": { "kind": "executionTime", "scope": "tool", "op": "gt", "ms": 30000 },
  "effect": { "type": "allow", "reason": "The transfer is taking longer than expected. Please do not retry - I'll confirm the status shortly." }
}
```

---

## Required Signals

```typescript
// Transaction validation
engine.registerSignal("transaction.exceedsSingleLimit", async ({ amount, currency }) => {
  const limits = { GBP: 10000, USD: 15000, EUR: 12000 };
  return amount > (limits[currency] || 10000);
});

engine.registerSignal("transaction.exceedsDailyLimit", async ({ amount, customerId }) => {
  const todayTotal = await db.getTodayTransferTotal(customerId);
  const dailyLimit = await db.getCustomerDailyLimit(customerId);
  return (todayTotal + amount) > dailyLimit;
});

engine.registerSignal("transaction.isInternational", async ({ recipientAccount }) => {
  return !recipientAccount.startsWith("GB");
});

engine.registerSignal("transaction.isLarge", async ({ amount, threshold }) => {
  return amount >= threshold;
});

// Beneficiary checks
engine.registerSignal("beneficiary.isNotSetup", async ({ accountNumber }, { ctx }) => {
  const beneficiaries = await db.getBeneficiaries(ctx.enduser.externalId);
  return !beneficiaries.includes(accountNumber);
});

engine.registerSignal("beneficiary.isInCoolingPeriod", async ({ accountNumber }, { ctx }) => {
  const beneficiary = await db.getBeneficiary(ctx.enduser.externalId, accountNumber);
  if (!beneficiary) return false;
  const hoursSinceAdded = (Date.now() - beneficiary.addedAt) / (1000 * 60 * 60);
  return hoursSinceAdded < 24;
});

// Fraud detection
engine.registerSignal("fraud.unusualAmountPattern", async ({ amount, customerId }) => {
  const avgTransfer = await db.getAverageTransferAmount(customerId);
  return amount > avgTransfer * 5; // 5x average is suspicious
});

// Validation
engine.registerSignal("validation.invalidAccountNumber", async ({ accountNumber }) => {
  const ukPattern = /^[0-9]{6}[0-9]{8}$/; // sort code + account
  return !ukPattern.test(accountNumber?.replace(/\s/g, ""));
});
```

---

## Subject Extractors

```typescript
engine.registerSubjectExtractor("transfer_funds", (args) => {
  return [{
    subjectType: "customer",
    role: "sender",
    value: args.runContext.enduser?.externalId,
    idSystem: "customer_id",
  }];
});

engine.registerSubjectExtractor("get_account_balance", (args) => {
  return [{
    subjectType: "account",
    role: "primary",
    value: args.toolArgs?.account_id,
    idSystem: "account_id",
  }];
});
```
