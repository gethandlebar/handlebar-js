# E-Commerce / Customer Support Rule Template

Rule pack template for agents handling orders, refunds, and customer service.

---

## Domain Context

### Typical Agent Functions
- Order lookup and tracking
- Refunds and returns
- Order modifications and cancellations
- Customer profile management
- Support ticket creation
- Product inquiries

### User Types
- Customers (external)
- Guest checkout users (external)
- Customer service agents (internal)
- Supervisors/managers (internal)
- Fraud team (internal)

### Sensitive Data
- Customer PII (name, email, phone, address)
- Payment information (last 4 digits)
- Order history
- Shipping addresses
- Purchase patterns

### Key Concerns
- Refund abuse/fraud
- Account takeover
- PII exposure
- Order manipulation
- Social engineering

---

## Tool Categories

```typescript
const ecommerceCategories: Record<string, string[]> = {
  // Order management
  lookup_order: ["read", "pii", "internal"],
  track_shipment: ["read", "internal"],
  cancel_order: ["write", "internal", "refund-related"],
  modify_order: ["write", "internal"],
  
  // Refunds and returns
  issue_refund: ["write", "financial", "irreversible", "sensitive"],
  create_return: ["write", "internal"],
  check_refund_status: ["read", "internal"],
  
  // Customer data
  get_customer_profile: ["read", "pii", "internal"],
  update_shipping_address: ["write", "pii", "internal"],
  update_email: ["write", "pii", "internal", "sensitive"],
  update_phone: ["write", "pii", "internal"],
  
  // Support
  create_ticket: ["write", "internal"],
  escalate_ticket: ["write", "escalation"],
  transfer_to_agent: ["escalation"],
  
  // Verification
  verify_customer: ["auth", "internal"],
  send_verification_email: ["auth", "external"],
  
  // Product
  check_inventory: ["read", "internal"],
  apply_discount: ["write", "financial", "manager-only"],
};
```

---

## Rule Pack

### 1. User Tags / Metadata (UM)

#### UM-001: Customer Identity Verification

```json
{
  "id": "ECOM-UM-001",
  "enabled": true,
  "priority": 100,
  "name": "Customer Identity Verification Required",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["pii", "financial"] } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "enduserTag", "op": "hasValue", "tag": "type", "value": "customer" },
      { "kind": "not", "not": { "kind": "enduserTag", "op": "hasValue", "tag": "verified", "value": "true" } }
    ]
  },
  "effect": { "type": "block", "reason": "Please verify your identity by confirming your email address and order number." }
}
```

#### UM-002: Guest User Restrictions

```json
{
  "id": "ECOM-UM-002",
  "enabled": true,
  "priority": 95,
  "name": "Guest User Limited Access",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["pii"] } },
  "condition": { "kind": "enduserTag", "op": "hasValue", "tag": "type", "value": "guest" },
  "effect": { "type": "block", "reason": "Guest users can only access order-specific information. Please provide your order number and email to continue." }
}
```

#### UM-003: Manager-Only Actions

```json
{
  "id": "ECOM-UM-003",
  "enabled": true,
  "priority": 90,
  "name": "Manager-Only Actions",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["manager-only"] } },
  "condition": {
    "kind": "not",
    "not": { "kind": "enduserTag", "op": "hasValueAny", "tag": "role", "values": ["manager", "supervisor", "admin"] }
  },
  "effect": { "type": "block", "reason": "This action requires manager approval. Let me connect you with a supervisor." }
}
```

#### UM-004: Flagged Account Restrictions

```json
{
  "id": "ECOM-UM-004",
  "enabled": true,
  "priority": 150,
  "name": "Flagged Account Restrictions",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["financial", "refund-related"] } },
  "condition": { "kind": "enduserTag", "op": "hasValue", "tag": "account_status", "value": "flagged" },
  "effect": { "type": "block", "reason": "There's an issue with your account that requires manual review. Please contact our support team directly." }
}
```

---

### 2. Tooling (TL)

#### TL-001: Refund Requires Order Lookup

```json
{
  "id": "ECOM-TL-001",
  "enabled": true,
  "priority": 85,
  "name": "Refund Requires Order Lookup First",
  "selector": { "phase": "tool.before", "tool": { "name": "issue_refund" } },
  "condition": { "kind": "sequence", "mustHaveCalled": ["lookup_order"] },
  "effect": { "type": "block", "reason": "Let me look up the order details first." }
}
```

#### TL-002: Refund Amount Validation

```json
{
  "id": "ECOM-TL-002",
  "enabled": true,
  "priority": 90,
  "name": "Refund Amount Cannot Exceed Order Value",
  "selector": { "phase": "tool.before", "tool": { "name": "issue_refund" } },
  "condition": {
    "kind": "signal",
    "key": "refund.exceedsOrderValue",
    "args": {
      "refundAmount": { "from": "toolArg", "path": "amount" },
      "orderId": { "from": "toolArg", "path": "order_id" }
    },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "The refund amount cannot exceed the original order value." }
}
```

#### TL-003: Partial Refund Explanation Required

```json
{
  "id": "ECOM-TL-003",
  "enabled": true,
  "priority": 75,
  "name": "Partial Refund Reason Required",
  "selector": { "phase": "tool.before", "tool": { "name": "issue_refund" } },
  "condition": {
    "kind": "signal",
    "key": "refund.isPartial",
    "args": {
      "refundAmount": { "from": "toolArg", "path": "amount" },
      "orderId": { "from": "toolArg", "path": "order_id" }
    },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "hitl", "reason": "You're requesting a partial refund. Can you confirm the reason for the partial amount?" }
}
```

#### TL-004: Email Change Requires Verification

```json
{
  "id": "ECOM-TL-004",
  "enabled": true,
  "priority": 95,
  "name": "Email Change Requires Additional Verification",
  "selector": { "phase": "tool.before", "tool": { "name": "update_email" } },
  "condition": { "kind": "toolName", "op": "eq", "value": "update_email" },
  "effect": { "type": "hitl", "reason": "Changing your email address requires additional verification. We'll send a confirmation to both your old and new email addresses. Do you wish to proceed?" }
}
```

---

### 3. Input Validation (IN)

#### IN-001: Refund Amount Threshold

```json
{
  "id": "ECOM-IN-001",
  "enabled": true,
  "priority": 80,
  "name": "Large Refund Approval Required",
  "selector": { "phase": "tool.before", "tool": { "name": "issue_refund" } },
  "condition": {
    "kind": "signal",
    "key": "refund.exceedsThreshold",
    "args": {
      "amount": { "from": "toolArg", "path": "amount" },
      "threshold": { "from": "const", "value": 100 }
    },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "hitl", "reason": "Refunds over £100 require supervisor approval. Let me get that for you." }
}
```

#### IN-002: Order ID Format Validation

```json
{
  "id": "ECOM-IN-002",
  "enabled": true,
  "priority": 60,
  "name": "Order ID Format Validation",
  "selector": { "phase": "tool.before", "tool": { "name": "lookup_order" } },
  "condition": {
    "kind": "signal",
    "key": "validation.invalidOrderId",
    "args": { "orderId": { "from": "toolArg", "path": "order_id" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "Please check your order number. It should start with 'ORD-' followed by numbers, for example ORD-123456." }
}
```

#### IN-003: Address Validation

```json
{
  "id": "ECOM-IN-003",
  "enabled": true,
  "priority": 55,
  "name": "Address Format Validation",
  "selector": { "phase": "tool.before", "tool": { "name": "update_shipping_address" } },
  "condition": {
    "kind": "signal",
    "key": "validation.incompleteAddress",
    "args": { "address": { "from": "toolArg", "path": "address" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "Please provide a complete address including street, city, and postcode." }
}
```

---

### 4. Metrics / Fraud Prevention (ME)

#### ME-001: Refund Rate Monitoring

```json
{
  "id": "ECOM-ME-001",
  "enabled": true,
  "priority": 100,
  "name": "High Refund Rate Detection",
  "selector": { "phase": "tool.before", "tool": { "name": "issue_refund" } },
  "condition": {
    "kind": "signal",
    "key": "customer.refundRateHigh",
    "args": { "customerId": { "from": "subject", "subjectType": "customer", "field": "id" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "hitl", "reason": "This account has an elevated refund rate. Manager review is required for this request." }
}
```

#### ME-002: Recent Refund Check

```json
{
  "id": "ECOM-ME-002",
  "enabled": true,
  "priority": 85,
  "name": "Recent Refund on Same Order",
  "selector": { "phase": "tool.before", "tool": { "name": "issue_refund" } },
  "condition": {
    "kind": "signal",
    "key": "order.hasRecentRefund",
    "args": { "orderId": { "from": "toolArg", "path": "order_id" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "A refund was already processed for this order recently. Please check the existing refund status or contact support for additional help." }
}
```

#### ME-003: Session Refund Limit

```json
{
  "id": "ECOM-ME-003",
  "enabled": true,
  "priority": 80,
  "name": "Session Refund Limit",
  "selector": { "phase": "tool.before", "tool": { "name": "issue_refund" } },
  "condition": { "kind": "maxCalls", "selector": { "by": "toolName", "patterns": ["issue_refund"] }, "max": 3 },
  "effect": { "type": "block", "reason": "Multiple refunds in a single session require manager review. Let me connect you with a supervisor." }
}
```

#### ME-004: First-Time Buyer Refund Check

```json
{
  "id": "ECOM-ME-004",
  "enabled": true,
  "priority": 75,
  "name": "First-Time Buyer Refund Escalation",
  "selector": { "phase": "tool.before", "tool": { "name": "issue_refund" } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "signal", "key": "customer.isFirstOrder", "args": { "orderId": { "from": "toolArg", "path": "order_id" } }, "op": "eq", "value": true },
      { "kind": "signal", "key": "refund.isFullRefund", "args": { "orderId": { "from": "toolArg", "path": "order_id" }, "amount": { "from": "toolArg", "path": "amount" } }, "op": "eq", "value": true }
    ]
  },
  "effect": { "type": "hitl", "reason": "Full refunds on first orders are flagged for review. Can you tell me more about the issue with your order?" }
}
```

---

### 5. Tool Ordering (TO)

#### TO-001: Verify Before PII Access

```json
{
  "id": "ECOM-TO-001",
  "enabled": true,
  "priority": 100,
  "name": "Verification Before PII Access",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["pii"] } },
  "condition": { "kind": "sequence", "mustHaveCalled": ["verify_customer"] },
  "effect": { "type": "block", "reason": "Please verify your identity by confirming your email and order number." }
}
```

#### TO-002: Lookup Before Cancellation

```json
{
  "id": "ECOM-TO-002",
  "enabled": true,
  "priority": 90,
  "name": "Order Lookup Before Cancellation",
  "selector": { "phase": "tool.before", "tool": { "name": "cancel_order" } },
  "condition": { "kind": "sequence", "mustHaveCalled": ["lookup_order"] },
  "effect": { "type": "block", "reason": "Let me look up your order first to check if it can still be cancelled." }
}
```

#### TO-003: Cancellation Confirmation

```json
{
  "id": "ECOM-TO-003",
  "enabled": true,
  "priority": 85,
  "name": "Cancellation Confirmation Required",
  "selector": { "phase": "tool.before", "tool": { "name": "cancel_order" } },
  "condition": { "kind": "toolName", "op": "eq", "value": "cancel_order" },
  "effect": { "type": "hitl", "reason": "Please confirm you want to cancel this order. This action cannot be undone if the order has already shipped." }
}
```

---

### 6. Temporal (TE)

#### TE-001: Refund Window Check

```json
{
  "id": "ECOM-TE-001",
  "enabled": true,
  "priority": 70,
  "name": "Refund Window Validation",
  "selector": { "phase": "tool.before", "tool": { "name": "issue_refund" } },
  "condition": {
    "kind": "signal",
    "key": "order.outsideRefundWindow",
    "args": { "orderId": { "from": "toolArg", "path": "order_id" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "hitl", "reason": "This order is outside our standard 30-day refund window. Let me check if we can make an exception." }
}
```

#### TE-002: Cancellation Window Check

```json
{
  "id": "ECOM-TE-002",
  "enabled": true,
  "priority": 75,
  "name": "Cancellation Window Check",
  "selector": { "phase": "tool.before", "tool": { "name": "cancel_order" } },
  "condition": {
    "kind": "signal",
    "key": "order.cannotCancel",
    "args": { "orderId": { "from": "toolArg", "path": "order_id" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "This order has already shipped and cannot be cancelled. Would you like to arrange a return instead?" }
}
```

---

### 7. Audience (AU)

#### AU-001: Customer Data Isolation

```json
{
  "id": "ECOM-AU-001",
  "enabled": true,
  "priority": 100,
  "name": "Customer Data Isolation",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["pii"] } },
  "condition": {
    "kind": "signal",
    "key": "customer.accessingOtherCustomerData",
    "args": {
      "requestedCustomerId": { "from": "toolArg", "path": "customer_id" },
      "sessionCustomerId": { "from": "subject", "subjectType": "customer", "field": "id" }
    },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "You can only access information about your own account and orders." }
}
```

---

## Required Signals

```typescript
// Refund validation
engine.registerSignal("refund.exceedsOrderValue", async ({ refundAmount, orderId }) => {
  const order = await db.getOrder(orderId);
  return refundAmount > order?.total;
});

engine.registerSignal("refund.exceedsThreshold", async ({ amount, threshold }) => {
  return amount >= threshold;
});

engine.registerSignal("refund.isPartial", async ({ refundAmount, orderId }) => {
  const order = await db.getOrder(orderId);
  return refundAmount < order?.total;
});

engine.registerSignal("refund.isFullRefund", async ({ refundAmount, orderId }) => {
  const order = await db.getOrder(orderId);
  return Math.abs(refundAmount - order?.total) < 0.01;
});

// Customer/fraud signals
engine.registerSignal("customer.refundRateHigh", async ({ customerId }) => {
  const stats = await db.getCustomerStats(customerId);
  return stats.refundRate > 0.3; // 30% refund rate
});

engine.registerSignal("customer.isFirstOrder", async ({ orderId }) => {
  const order = await db.getOrder(orderId);
  const orderCount = await db.getCustomerOrderCount(order.customerId);
  return orderCount === 1;
});

// Order signals
engine.registerSignal("order.hasRecentRefund", async ({ orderId }) => {
  const refunds = await db.getOrderRefunds(orderId);
  const recentRefund = refunds.find(r => 
    (Date.now() - r.createdAt) < 7 * 24 * 60 * 60 * 1000 // 7 days
  );
  return !!recentRefund;
});

engine.registerSignal("order.outsideRefundWindow", async ({ orderId }) => {
  const order = await db.getOrder(orderId);
  const daysSinceDelivery = (Date.now() - order.deliveredAt) / (1000 * 60 * 60 * 24);
  return daysSinceDelivery > 30;
});

engine.registerSignal("order.cannotCancel", async ({ orderId }) => {
  const order = await db.getOrder(orderId);
  return order.status === "shipped" || order.status === "delivered";
});

// Validation
engine.registerSignal("validation.invalidOrderId", async ({ orderId }) => {
  return !/^ORD-[0-9]+$/.test(orderId || "");
});

engine.registerSignal("validation.incompleteAddress", async ({ address }) => {
  return !address?.street || !address?.city || !address?.postcode;
});

// Data access
engine.registerSignal("customer.accessingOtherCustomerData", async ({ requestedCustomerId, sessionCustomerId }) => {
  return requestedCustomerId && requestedCustomerId !== sessionCustomerId;
});
```

---

## Subject Extractors

```typescript
engine.registerSubjectExtractor("lookup_order", (args) => {
  const orderId = args.toolArgs?.order_id;
  if (!orderId) return [];
  return [{
    subjectType: "order",
    role: "primary",
    value: orderId,
    idSystem: "order_id",
  }];
});

engine.registerSubjectExtractor("issue_refund", (args) => {
  return [
    {
      subjectType: "order",
      role: "primary",
      value: args.toolArgs?.order_id,
      idSystem: "order_id",
    },
    {
      subjectType: "customer",
      role: "requester",
      value: args.runContext.enduser?.externalId,
      idSystem: "customer_id",
    },
  ];
});
```
