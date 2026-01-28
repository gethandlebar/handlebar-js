# HR / Internal Operations Rule Template

Rule pack template for agents handling employee data, HR processes, and internal systems.

---

## Domain Context

### Typical Agent Functions
- Employee profile lookup
- Leave request management
- Payroll inquiries
- Policy questions
- System access requests
- Onboarding/offboarding

### User Types
- Employees (internal)
- Managers (internal)
- HR team (internal)
- IT administrators (internal)
- External contractors (limited)

### Sensitive Data
- Employee PII (SSN, address, DOB)
- Salary and compensation
- Performance reviews
- Medical/leave information
- Bank account details
- Emergency contacts

### Regulatory Context
- Employment law
- GDPR / Data Protection
- Equal opportunity regulations
- Payroll compliance
- Record retention requirements

### Key Risks
- Unauthorized salary disclosure
- PII exposure
- Inappropriate access to performance data
- Leave abuse
- System access misuse

---

## Tool Categories

```typescript
const hrCategories: Record<string, string[]> = {
  // Employee data
  lookup_employee: ["read", "pii", "internal", "hr-data"],
  get_employee_profile: ["read", "pii", "internal"],
  update_employee_record: ["write", "pii", "internal", "hr-data", "audit-required"],
  update_emergency_contact: ["write", "pii", "internal"],
  
  // Leave management
  check_leave_balance: ["read", "internal"],
  submit_leave_request: ["write", "internal"],
  approve_leave: ["write", "internal", "manager-only"],
  cancel_leave: ["write", "internal"],
  
  // Payroll
  view_payslip: ["read", "pii", "financial", "internal"],
  view_salary_info: ["read", "pii", "financial", "internal", "sensitive"],
  update_bank_details: ["write", "pii", "financial", "sensitive", "audit-required"],
  
  // Performance
  view_performance_review: ["read", "pii", "internal", "sensitive"],
  submit_self_assessment: ["write", "internal"],
  
  // Access management
  request_system_access: ["write", "internal", "it-approval"],
  revoke_access: ["write", "internal", "admin-only"],
  reset_password: ["write", "auth", "internal"],
  
  // Policy
  lookup_policy: ["read", "internal"],
  report_issue: ["write", "internal", "escalation"],
  
  // Verification
  verify_employee: ["auth", "internal"],
};
```

---

## Rule Pack

### 1. User Tags / Metadata (UM)

#### UM-001: Employee Verification Required

```json
{
  "id": "HR-UM-001",
  "enabled": true,
  "priority": 100,
  "name": "Employee Verification Required",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["pii", "financial"] } },
  "condition": {
    "kind": "not",
    "not": { "kind": "enduserTag", "op": "hasValue", "tag": "verified", "value": "true" }
  },
  "effect": { "type": "block", "reason": "Please verify your identity using your employee ID and registered email." }
}
```

#### UM-002: Manager-Only Actions

```json
{
  "id": "HR-UM-002",
  "enabled": true,
  "priority": 95,
  "name": "Manager-Only Actions",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["manager-only"] } },
  "condition": {
    "kind": "not",
    "not": { "kind": "enduserTag", "op": "hasValueAny", "tag": "role", "values": ["manager", "hr_admin", "department_head"] }
  },
  "effect": { "type": "block", "reason": "This action requires manager privileges." }
}
```

#### UM-003: HR Admin Override

```json
{
  "id": "HR-UM-003",
  "enabled": true,
  "priority": 200,
  "name": "HR Admin Full Access",
  "selector": { "phase": "tool.before" },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "enduserTag", "op": "hasValue", "tag": "role", "value": "hr_admin" },
      { "kind": "enduserTag", "op": "hasValue", "tag": "authenticated", "value": "true" }
    ]
  },
  "effect": { "type": "allow", "reason": "HR admin access granted." }
}
```

#### UM-004: Contractor Restrictions

```json
{
  "id": "HR-UM-004",
  "enabled": true,
  "priority": 90,
  "name": "Contractor Limited Access",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["hr-data", "sensitive"] } },
  "condition": { "kind": "enduserTag", "op": "hasValue", "tag": "employment_type", "value": "contractor" },
  "effect": { "type": "block", "reason": "Contractors have limited access to HR systems. Please contact HR for assistance." }
}
```

#### UM-005: Terminated Employee Check

```json
{
  "id": "HR-UM-005",
  "enabled": true,
  "priority": 150,
  "name": "Terminated Employee Access Block",
  "selector": { "phase": "tool.before" },
  "condition": { "kind": "enduserTag", "op": "hasValue", "tag": "employment_status", "value": "terminated" },
  "effect": { "type": "block", "reason": "Access is no longer available. Please contact HR if you need assistance with final documentation." }
}
```

---

### 2. Tooling (TL)

#### TL-001: Salary Info Access Control

```json
{
  "id": "HR-TL-001",
  "enabled": true,
  "priority": 100,
  "name": "Salary Information Access Control",
  "selector": { "phase": "tool.before", "tool": { "name": "view_salary_info" } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "signal", "key": "employee.viewingOtherEmployee", "op": "eq", "value": true },
      { "kind": "not", "not": { "kind": "enduserTag", "op": "hasValueAny", "tag": "role", "values": ["hr_admin", "payroll_admin", "cfo"] } }
    ]
  },
  "effect": { "type": "block", "reason": "You can only view your own salary information. Managers can request team compensation reports through HR." }
}
```

#### TL-002: Bank Details Change Verification

```json
{
  "id": "HR-TL-002",
  "enabled": true,
  "priority": 95,
  "name": "Bank Details Change Requires Verification",
  "selector": { "phase": "tool.before", "tool": { "name": "update_bank_details" } },
  "condition": { "kind": "toolName", "op": "eq", "value": "update_bank_details" },
  "effect": { "type": "hitl", "reason": "For security, bank detail changes require additional verification. Please confirm your identity and the new account details." }
}
```

#### TL-003: Performance Review Access

```json
{
  "id": "HR-TL-003",
  "enabled": true,
  "priority": 90,
  "name": "Performance Review Access Control",
  "selector": { "phase": "tool.before", "tool": { "name": "view_performance_review" } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "signal", "key": "employee.viewingOtherEmployee", "op": "eq", "value": true },
      { "kind": "not", "not": { "kind": "signal", "key": "employee.isDirectReport", "op": "eq", "value": true } },
      { "kind": "not", "not": { "kind": "enduserTag", "op": "hasValue", "tag": "role", "value": "hr_admin" } }
    ]
  },
  "effect": { "type": "block", "reason": "You can only view performance reviews for yourself or your direct reports." }
}
```

#### TL-004: System Access Request Routing

```json
{
  "id": "HR-TL-004",
  "enabled": true,
  "priority": 80,
  "name": "System Access Request Routing",
  "selector": { "phase": "tool.after", "tool": { "name": "request_system_access" } },
  "condition": { "kind": "toolName", "op": "eq", "value": "request_system_access" },
  "effect": { "type": "allow", "reason": "Your access request has been submitted. It requires manager approval followed by IT review. You'll receive an email when it's processed." }
}
```

#### TL-005: Audit All HR Data Changes

```json
{
  "id": "HR-TL-005",
  "enabled": true,
  "priority": 50,
  "name": "Audit All HR Data Changes",
  "selector": { "phase": "tool.after", "tool": { "tagsAny": ["audit-required"] } },
  "condition": { "kind": "toolTag", "op": "has", "tag": "audit-required" },
  "effect": { "type": "allow", "reason": "Change logged for compliance." }
}
```

---

### 3. Input Validation (IN)

#### IN-001: Leave Duration Validation

```json
{
  "id": "HR-IN-001",
  "enabled": true,
  "priority": 70,
  "name": "Leave Duration Validation",
  "selector": { "phase": "tool.before", "tool": { "name": "submit_leave_request" } },
  "condition": {
    "kind": "signal",
    "key": "leave.exceedsBalance",
    "args": {
      "days": { "from": "toolArg", "path": "days" },
      "leaveType": { "from": "toolArg", "path": "leave_type" }
    },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "This request exceeds your available leave balance. Please check your balance or request unpaid leave." }
}
```

#### IN-002: Bank Account Format Validation

```json
{
  "id": "HR-IN-002",
  "enabled": true,
  "priority": 60,
  "name": "Bank Account Format Validation",
  "selector": { "phase": "tool.before", "tool": { "name": "update_bank_details" } },
  "condition": {
    "kind": "signal",
    "key": "validation.invalidBankAccount",
    "args": {
      "sortCode": { "from": "toolArg", "path": "sort_code" },
      "accountNumber": { "from": "toolArg", "path": "account_number" }
    },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "Please check your bank details. Sort code should be 6 digits and account number should be 8 digits." }
}
```

#### IN-003: Leave Date Validation

```json
{
  "id": "HR-IN-003",
  "enabled": true,
  "priority": 65,
  "name": "Leave Date Validation",
  "selector": { "phase": "tool.before", "tool": { "name": "submit_leave_request" } },
  "condition": {
    "kind": "signal",
    "key": "leave.dateInPast",
    "args": { "startDate": { "from": "toolArg", "path": "start_date" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "Leave requests cannot be submitted for past dates. Please contact HR for backdated requests." }
}
```

---

### 4. Tool Ordering (TO)

#### TO-001: Verify Before Sensitive Actions

```json
{
  "id": "HR-TO-001",
  "enabled": true,
  "priority": 100,
  "name": "Verification Before Sensitive Actions",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["sensitive", "financial"] } },
  "condition": { "kind": "sequence", "mustHaveCalled": ["verify_employee"] },
  "effect": { "type": "block", "reason": "Please verify your identity before accessing sensitive information." }
}
```

#### TO-002: Leave Balance Check Before Request

```json
{
  "id": "HR-TO-002",
  "enabled": true,
  "priority": 85,
  "name": "Leave Balance Check Before Request",
  "selector": { "phase": "tool.before", "tool": { "name": "submit_leave_request" } },
  "condition": { "kind": "sequence", "mustHaveCalled": ["check_leave_balance"] },
  "effect": { "type": "block", "reason": "Let me check your leave balance first." }
}
```

#### TO-003: Manager Approval Flow

```json
{
  "id": "HR-TO-003",
  "enabled": true,
  "priority": 80,
  "name": "Leave Approval Requires Submission",
  "selector": { "phase": "tool.before", "tool": { "name": "approve_leave" } },
  "condition": {
    "kind": "signal",
    "key": "leave.requestExists",
    "args": { "requestId": { "from": "toolArg", "path": "request_id" } },
    "op": "eq",
    "value": false
  },
  "effect": { "type": "block", "reason": "No pending leave request found with this ID." }
}
```

---

### 5. Audience (AU)

#### AU-001: Employee Data Isolation

```json
{
  "id": "HR-AU-001",
  "enabled": true,
  "priority": 100,
  "name": "Employee Data Isolation",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["pii"] } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "signal", "key": "employee.viewingOtherEmployee", "op": "eq", "value": true },
      { "kind": "not", "not": { "kind": "enduserTag", "op": "hasValueAny", "tag": "role", "values": ["hr_admin", "manager"] } }
    ]
  },
  "effect": { "type": "block", "reason": "You can only access your own employee information." }
}
```

#### AU-002: Manager Team Scope

```json
{
  "id": "HR-AU-002",
  "enabled": true,
  "priority": 95,
  "name": "Manager Access Limited to Team",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["hr-data"] } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "enduserTag", "op": "hasValue", "tag": "role", "value": "manager" },
      { "kind": "signal", "key": "employee.viewingOtherEmployee", "op": "eq", "value": true },
      { "kind": "not", "not": { "kind": "signal", "key": "employee.isDirectReport", "op": "eq", "value": true } }
    ]
  },
  "effect": { "type": "block", "reason": "Managers can only access data for their direct reports. Please contact HR for other employee information." }
}
```

---

### 6. Temporal (TE)

#### TE-001: Leave Request Notice Period

```json
{
  "id": "HR-TE-001",
  "enabled": true,
  "priority": 70,
  "name": "Leave Request Notice Period",
  "selector": { "phase": "tool.before", "tool": { "name": "submit_leave_request" } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "signal", "key": "leave.insufficientNotice", "args": { "startDate": { "from": "toolArg", "path": "start_date" }, "days": { "from": "toolArg", "path": "days" } }, "op": "eq", "value": true },
      { "kind": "signal", "key": "leave.isAnnualLeave", "args": { "leaveType": { "from": "toolArg", "path": "leave_type" } }, "op": "eq", "value": true }
    ]
  },
  "effect": { "type": "hitl", "reason": "Annual leave of 5+ days typically requires 2 weeks notice. Would you like to submit anyway for manager review?" }
}
```

#### TE-002: Blackout Period Check

```json
{
  "id": "HR-TE-002",
  "enabled": true,
  "priority": 75,
  "name": "Leave Blackout Period Check",
  "selector": { "phase": "tool.before", "tool": { "name": "submit_leave_request" } },
  "condition": {
    "kind": "signal",
    "key": "leave.duringBlackout",
    "args": {
      "startDate": { "from": "toolArg", "path": "start_date" },
      "endDate": { "from": "toolArg", "path": "end_date" }
    },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "hitl", "reason": "This period is marked as a blackout period for your department. Leave requests require department head approval." }
}
```

---

### 7. Metrics (ME)

#### ME-001: Team Leave Capacity

```json
{
  "id": "HR-ME-001",
  "enabled": true,
  "priority": 65,
  "name": "Team Leave Capacity Check",
  "selector": { "phase": "tool.before", "tool": { "name": "submit_leave_request" } },
  "condition": {
    "kind": "signal",
    "key": "team.atLeaveCapacity",
    "args": {
      "startDate": { "from": "toolArg", "path": "start_date" },
      "endDate": { "from": "toolArg", "path": "end_date" }
    },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "hitl", "reason": "Multiple team members are already on leave during this period. Your request will need manager review to ensure coverage." }
}
```

---

## Required Signals

```typescript
// Access control
engine.registerSignal("employee.viewingOtherEmployee", async (args, { ctx }) => {
  const targetEmployeeId = args.employeeId || args.employee_id;
  const currentEmployeeId = ctx.enduser?.externalId;
  return targetEmployeeId && targetEmployeeId !== currentEmployeeId;
});

engine.registerSignal("employee.isDirectReport", async (args, { ctx }) => {
  const targetEmployeeId = args.employeeId || args.employee_id;
  const managerId = ctx.enduser?.externalId;
  const reports = await db.getDirectReports(managerId);
  return reports.includes(targetEmployeeId);
});

// Leave validation
engine.registerSignal("leave.exceedsBalance", async ({ days, leaveType }, { ctx }) => {
  const balance = await db.getLeaveBalance(ctx.enduser.externalId, leaveType);
  return days > balance;
});

engine.registerSignal("leave.dateInPast", async ({ startDate }) => {
  return new Date(startDate) < new Date();
});

engine.registerSignal("leave.insufficientNotice", async ({ startDate, days }) => {
  const daysUntilStart = (new Date(startDate) - Date.now()) / (1000 * 60 * 60 * 24);
  return days >= 5 && daysUntilStart < 14;
});

engine.registerSignal("leave.isAnnualLeave", async ({ leaveType }) => {
  return leaveType === "annual" || leaveType === "vacation";
});

engine.registerSignal("leave.duringBlackout", async ({ startDate, endDate }, { ctx }) => {
  const blackouts = await db.getBlackoutPeriods(ctx.enduser.metadata?.department);
  return blackouts.some(b => 
    new Date(startDate) <= new Date(b.end) && new Date(endDate) >= new Date(b.start)
  );
});

engine.registerSignal("leave.requestExists", async ({ requestId }) => {
  const request = await db.getLeaveRequest(requestId);
  return !!request;
});

engine.registerSignal("team.atLeaveCapacity", async ({ startDate, endDate }, { ctx }) => {
  const teamOnLeave = await db.getTeamLeaveCount(ctx.enduser.metadata?.department, startDate, endDate);
  const teamSize = await db.getTeamSize(ctx.enduser.metadata?.department);
  return teamOnLeave / teamSize > 0.3; // 30% of team already off
});

// Validation
engine.registerSignal("validation.invalidBankAccount", async ({ sortCode, accountNumber }) => {
  return !/^[0-9]{6}$/.test(sortCode) || !/^[0-9]{8}$/.test(accountNumber);
});
```

---

## Subject Extractors

```typescript
engine.registerSubjectExtractor("lookup_employee", (args) => {
  const employeeId = args.toolArgs?.employee_id;
  if (!employeeId) return [];
  return [{
    subjectType: "employee",
    role: "target",
    value: employeeId,
    idSystem: "employee_id",
  }];
});

engine.registerSubjectExtractor("submit_leave_request", (args) => {
  return [{
    subjectType: "employee",
    role: "requester",
    value: args.runContext.enduser?.externalId,
    idSystem: "employee_id",
  }];
});
```
