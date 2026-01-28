# Healthcare / Patient Services Rule Template

Rule pack template for agents handling patient data, appointments, and clinical systems.

---

## Domain Context

### Typical Agent Functions
- Patient appointment booking, rescheduling, cancellation
- Patient record lookup and updates
- Clinical system integration (EMIS, SystmOne, Vision)
- NHS Spine/PDS integration
- SMS/email communication

### User Types
- Prospective patients (external)
- Registered patients (external)
- Reception staff (internal)
- Practice managers (internal)
- Clinical staff (internal)

### Sensitive Data
- Patient PII (name, DOB, contact details, address)
- NHS numbers
- Health information (presenting complaints, medical history)
- Appointment history
- Clinician schedules

### Regulatory Context
- UK GDPR / Data Protection Act 2018
- HIPAA (US)
- NHS Data Security and Protection Toolkit
- Caldicott Principles
- CQC standards

### Key Risks
- Providing medical advice beyond scope
- Booking inappropriate appointment types for urgent symptoms
- Exposing other patients' information
- Failing to detect and escalate emergencies
- Overbooking clinicians
- Missing critical preparation instructions

---

## Tool Categories

```typescript
const healthcareCategories: Record<string, string[]> = {
  // Patient data tools
  lookup_patient: ["pii", "phi", "read", "internal"],
  lookup_nhs_number: ["pii", "external", "spine-access", "audit-required"],
  create_patient_record: ["write", "pii", "phi", "registration"],
  update_contact_details: ["write", "pii", "internal"],
  
  // Appointment tools
  check_availability: ["read", "internal"],
  book_appointment: ["write", "internal", "patient-facing"],
  cancel_appointment: ["write", "internal", "patient-facing"],
  reschedule_appointment: ["write", "internal", "patient-facing"],
  
  // Communication tools
  send_confirmation_email: ["write", "external", "patient-facing"],
  send_sms_reminder: ["write", "external", "consent-required"],
  
  // Clinical tools
  query_clinician_schedule: ["read", "internal", "staff-only"],
  transfer_to_clinical: ["escalation", "clinical"],
  transfer_to_human: ["escalation"],
  
  // Lookup tools
  lookup_surgery_locations: ["read", "internal"],
  lookup_service_types: ["read", "internal"],
};
```

---

## Rule Pack

### 1. User Tags / Metadata (UM)

#### UM-001: Patient Identity Verification

```json
{
  "id": "HC-UM-001",
  "enabled": true,
  "priority": 100,
  "name": "Patient Identity Verification",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["patient-facing"] } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "enduserTag", "op": "hasValue", "tag": "type", "value": "patient" },
      { "kind": "not", "not": { "kind": "enduserTag", "op": "hasValue", "tag": "verified", "value": "true" } }
    ]
  },
  "effect": { "type": "block", "reason": "For your protection, please verify your identity by confirming your date of birth and the phone number registered with our practice." }
}
```

#### UM-002: New Patient Booking Scope

```json
{
  "id": "HC-UM-002",
  "enabled": true,
  "priority": 95,
  "name": "New Patient Booking Scope",
  "selector": { "phase": "tool.before", "tool": { "name": "book_appointment" } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "enduserTag", "op": "hasValue", "tag": "type", "value": "prospective_patient" },
      { "kind": "signal", "key": "appointment.isNewPatientType", "op": "eq", "value": false }
    ]
  },
  "effect": { "type": "block", "reason": "As a new patient, your first appointment must be a New Patient Registration. This allows us to complete your NHS registration and medical history review." }
}
```

#### UM-003: Reception Staff Override

```json
{
  "id": "HC-UM-003",
  "enabled": true,
  "priority": 200,
  "name": "Reception Staff Override Privileges",
  "selector": { "phase": "tool.before" },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "enduserTag", "op": "hasValue", "tag": "role", "value": "reception_staff" },
      { "kind": "enduserTag", "op": "hasValue", "tag": "authenticated", "value": "true" }
    ]
  },
  "effect": { "type": "allow", "reason": "Staff override permitted." }
}
```

#### UM-004: Under-16 Guardian Requirement

```json
{
  "id": "HC-UM-004",
  "enabled": true,
  "priority": 90,
  "name": "Under-16 Patient Guardian Requirement",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["patient-facing"] } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "signal", "key": "patient.isUnder16", "op": "eq", "value": true },
      { "kind": "not", "not": { "kind": "enduserTag", "op": "hasValueAny", "tag": "relationship", "values": ["parent", "legal_guardian"] } }
    ]
  },
  "effect": { "type": "block", "reason": "Appointments for patients under 16 must be arranged by a parent or legal guardian registered on our system." }
}
```

---

### 2. Tooling (TL)

#### TL-001: NHS Number Lookup Logging

```json
{
  "id": "HC-TL-001",
  "enabled": true,
  "priority": 50,
  "name": "NHS Number Lookup Logging",
  "selector": { "phase": "tool.after", "tool": { "name": "lookup_nhs_number" } },
  "condition": { "kind": "toolName", "op": "eq", "value": "lookup_nhs_number" },
  "effect": { "type": "allow", "reason": "NHS number lookup logged for Information Governance compliance." }
}
```

#### TL-002: SMS Consent Verification

```json
{
  "id": "HC-TL-002",
  "enabled": true,
  "priority": 80,
  "name": "SMS Reminder Consent Verification",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["consent-required"] } },
  "condition": { "kind": "not", "not": { "kind": "enduserTag", "op": "hasValue", "tag": "sms_consent", "value": "true" } },
  "effect": { "type": "block", "reason": "We don't have SMS consent recorded for you. Would you like to receive appointment reminders via email instead?" }
}
```

#### TL-003: Clinician Schedule Restrictions

```json
{
  "id": "HC-TL-003",
  "enabled": true,
  "priority": 85,
  "name": "Clinician Schedule Query Restrictions",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["staff-only"] } },
  "condition": {
    "kind": "not",
    "not": { "kind": "enduserTag", "op": "hasValueAny", "tag": "role", "values": ["reception_staff", "practice_manager", "clinical_staff"] }
  },
  "effect": { "type": "block", "reason": "I can show you available appointment slots but cannot display other patients' information." }
}
```

#### TL-004: Contact Details Update Verification

```json
{
  "id": "HC-TL-004",
  "enabled": true,
  "priority": 75,
  "name": "Contact Details Update Verification",
  "selector": { "phase": "tool.before", "tool": { "name": "update_contact_details" } },
  "condition": { "kind": "toolName", "op": "eq", "value": "update_contact_details" },
  "effect": { "type": "hitl", "reason": "Please confirm you want to update your contact details. Reply YES to confirm." }
}
```

---

### 3. Input Validation (IN)

#### IN-001: Emergency Symptom Detection

```json
{
  "id": "HC-IN-001",
  "enabled": true,
  "priority": 200,
  "name": "Emergency Symptom Detection",
  "selector": { "phase": "tool.before", "tool": { "name": "book_appointment" } },
  "condition": {
    "kind": "signal",
    "key": "symptom.isEmergency",
    "args": { "symptoms": { "from": "toolArg", "path": "presenting_complaint" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "Based on what you've described, please call 999 immediately or go to your nearest A&E. If you're unsure, call NHS 111. Are you safe?" }
}
```

**Signal implementation:**
```typescript
engine.registerSignal("symptom.isEmergency", async ({ symptoms }) => {
  const emergencyKeywords = [
    "chest pain", "difficulty breathing", "severe bleeding",
    "loss of consciousness", "stroke", "suicidal", "overdose",
    "heart attack", "cannot breathe", "unresponsive"
  ];
  const lower = (symptoms || "").toLowerCase();
  return emergencyKeywords.some(kw => lower.includes(kw));
});
```

#### IN-002: Urgent Symptom Routing

```json
{
  "id": "HC-IN-002",
  "enabled": true,
  "priority": 150,
  "name": "Appointment Type-Symptom Validation",
  "selector": { "phase": "tool.before", "tool": { "name": "book_appointment" } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "signal", "key": "appointment.isRoutine", "args": { "type": { "from": "toolArg", "path": "appointment_type" } }, "op": "eq", "value": true },
      { "kind": "signal", "key": "symptom.isUrgent", "args": { "symptoms": { "from": "toolArg", "path": "presenting_complaint" } }, "op": "eq", "value": true }
    ]
  },
  "effect": { "type": "block", "reason": "Your symptoms may need more urgent attention. Let me check same-day or urgent appointment availability, or I can connect you with our duty clinician." }
}
```

#### IN-003: NHS Number Format Validation

```json
{
  "id": "HC-IN-003",
  "enabled": true,
  "priority": 60,
  "name": "NHS Number Format Validation",
  "selector": { "phase": "tool.before", "tool": { "name": "lookup_nhs_number" } },
  "condition": {
    "kind": "signal",
    "key": "validation.nhsNumberInvalid",
    "args": { "nhsNumber": { "from": "toolArg", "path": "nhs_number" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "Please provide a valid 10-digit NHS number. You can find this on your NHS letter, prescription, or NHS App." }
}
```

#### IN-004: Fasting Requirement Auto-Detection

```json
{
  "id": "HC-IN-004",
  "enabled": true,
  "priority": 70,
  "name": "Fasting Requirement Auto-Detection",
  "selector": { "phase": "tool.after", "tool": { "name": "book_appointment" } },
  "condition": {
    "kind": "signal",
    "key": "appointment.requiresFasting",
    "args": { "serviceType": { "from": "toolArg", "path": "service_type" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "allow", "reason": "This appointment requires fasting. Please do not eat or drink anything except water for 10-12 hours before your appointment. Continue taking prescribed medications unless advised otherwise." }
}
```

---

### 4. Temporal (TE)

#### TE-001: Operating Hours

```json
{
  "id": "HC-TE-001",
  "enabled": true,
  "priority": 40,
  "name": "Operating Hours Enforcement",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["patient-facing"] } },
  "condition": {
    "kind": "not",
    "not": {
      "kind": "timeGate",
      "windows": [{ "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "start": "07:00", "end": "22:00" }]
    }
  },
  "effect": { "type": "block", "reason": "Our booking service operates 7am-10pm. For urgent medical needs, please contact NHS 111." }
}
```

#### TE-002: Minimum Booking Lead Time

```json
{
  "id": "HC-TE-002",
  "enabled": true,
  "priority": 55,
  "name": "Minimum Booking Lead Time",
  "selector": { "phase": "tool.before", "tool": { "name": "book_appointment" } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "signal", "key": "appointment.isUnderLeadTime", "args": { "datetime": { "from": "toolArg", "path": "appointment_datetime" }, "hours": { "from": "const", "value": 2 } }, "op": "eq", "value": true },
      { "kind": "signal", "key": "appointment.isRoutine", "args": { "type": { "from": "toolArg", "path": "appointment_type" } }, "op": "eq", "value": true }
    ]
  },
  "effect": { "type": "block", "reason": "Routine appointments require at least 2 hours advance booking. For same-day urgent needs, please ring the surgery directly or contact NHS 111." }
}
```

#### TE-003: Cancellation Notice Period

```json
{
  "id": "HC-TE-003",
  "enabled": true,
  "priority": 50,
  "name": "Cancellation Notice Period",
  "selector": { "phase": "tool.before", "tool": { "name": "cancel_appointment" } },
  "condition": {
    "kind": "signal",
    "key": "appointment.isWithin24Hours",
    "args": { "appointmentId": { "from": "toolArg", "path": "appointment_id" } },
    "op": "eq",
    "value": true
  },
  "effect": { "type": "hitl", "reason": "Late cancellations make it difficult for other patients to access appointments. Do you wish to proceed with cancellation?" }
}
```

#### TE-004: Rate Limiting

```json
{
  "id": "HC-TE-004",
  "enabled": true,
  "priority": 45,
  "name": "Rate Limiting Per Patient",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["patient-facing"] } },
  "condition": { "kind": "maxCalls", "selector": { "by": "toolTag", "tags": ["patient-facing"] }, "max": 10 },
  "effect": { "type": "block", "reason": "You've made several requests recently. Please wait a few minutes before trying again, or ring the surgery for assistance." }
}
```

---

### 5. Tool Ordering (TO)

#### TO-001: Identity Verification Before Booking

```json
{
  "id": "HC-TO-001",
  "enabled": true,
  "priority": 100,
  "name": "Identity Verification Before Booking",
  "selector": { "phase": "tool.before", "tool": { "name": "book_appointment" } },
  "condition": { "kind": "sequence", "mustHaveCalled": ["verify_patient_identity"] },
  "effect": { "type": "block", "reason": "Before booking, I need to verify your identity. Can you please confirm your date of birth and postcode?" }
}
```

#### TO-002: Availability Check Before Booking

```json
{
  "id": "HC-TO-002",
  "enabled": true,
  "priority": 95,
  "name": "Availability Check Before Booking",
  "selector": { "phase": "tool.before", "tool": { "name": "book_appointment" } },
  "condition": { "kind": "sequence", "mustHaveCalled": ["check_availability"] },
  "effect": { "type": "block", "reason": "Let me first check availability for your requested time." }
}
```

#### TO-003: Confirmation After Booking

```json
{
  "id": "HC-TO-003",
  "enabled": true,
  "priority": 90,
  "name": "Confirmation After Successful Booking",
  "selector": { "phase": "tool.after", "tool": { "name": "book_appointment" } },
  "condition": { "kind": "signal", "key": "booking.wasSuccessful", "op": "eq", "value": true },
  "effect": { "type": "allow", "reason": "Your appointment is booked. Sending confirmation now." }
}
```

#### TO-004: Clinical Escalation Before Emergency

```json
{
  "id": "HC-TO-004",
  "enabled": true,
  "priority": 200,
  "name": "Clinical Escalation Before Emergency Booking",
  "selector": { "phase": "tool.before", "tool": { "name": "book_appointment" } },
  "condition": {
    "kind": "and",
    "all": [
      { "kind": "signal", "key": "appointment.isEmergency", "args": { "type": { "from": "toolArg", "path": "appointment_type" } }, "op": "eq", "value": true },
      { "kind": "sequence", "mustHaveCalled": ["transfer_to_clinical"] }
    ]
  },
  "effect": { "type": "block", "reason": "Given the urgency, I'm connecting you with our duty clinician immediately. If this is a life-threatening emergency, please hang up and dial 999." }
}
```

---

### 6. Audience (AU)

#### AU-001: Patient Data Isolation

```json
{
  "id": "HC-AU-001",
  "enabled": true,
  "priority": 100,
  "name": "Patient-Facing Data Restrictions",
  "selector": { "phase": "tool.before", "tool": { "tagsAny": ["phi"] } },
  "condition": {
    "kind": "signal",
    "key": "patient.isAccessingOtherPatientData",
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "I can only share information about your own appointments and records." }
}
```

#### AU-002: Clinical Information Routing

```json
{
  "id": "HC-AU-002",
  "enabled": true,
  "priority": 95,
  "name": "Clinical Information Routing",
  "selector": { "phase": "tool.before" },
  "condition": {
    "kind": "signal",
    "key": "query.isClinicalAdvice",
    "op": "eq",
    "value": true
  },
  "effect": { "type": "block", "reason": "For clinical questions, let me connect you with our clinical team who can provide appropriate guidance. For urgent concerns, please contact NHS 111." }
}
```

---

### 7. Execution Time (EX)

#### EX-001: Clinical System Timeout

```json
{
  "id": "HC-EX-001",
  "enabled": true,
  "priority": 30,
  "name": "Clinical System Query Timeout",
  "selector": { "phase": "tool.after", "tool": { "tagsAny": ["internal"] } },
  "condition": { "kind": "executionTime", "scope": "tool", "op": "gt", "ms": 10000 },
  "effect": { "type": "block", "reason": "Our systems are responding slowly. Let me try again, or I can transfer you to reception." }
}
```

#### EX-002: NHS Spine Timeout

```json
{
  "id": "HC-EX-002",
  "enabled": true,
  "priority": 30,
  "name": "NHS Spine/PDS Lookup Timeout",
  "selector": { "phase": "tool.after", "tool": { "name": "lookup_nhs_number" } },
  "condition": { "kind": "executionTime", "scope": "tool", "op": "gt", "ms": 30000 },
  "effect": { "type": "allow", "reason": "NHS number verification is taking longer than expected. I can proceed with your booking and we'll verify your details before your appointment." }
}
```

---

## Required Signals

Implement these signals for the healthcare rule pack:

```typescript
// Emergency detection
engine.registerSignal("symptom.isEmergency", async ({ symptoms }) => {
  const emergencyKeywords = ["chest pain", "difficulty breathing", "severe bleeding", "loss of consciousness", "stroke", "suicidal", "overdose"];
  return emergencyKeywords.some(kw => (symptoms || "").toLowerCase().includes(kw));
});

// Urgent symptom detection
engine.registerSignal("symptom.isUrgent", async ({ symptoms }) => {
  const urgentKeywords = ["high fever", "severe pain", "infection", "injury", "vomiting blood"];
  return urgentKeywords.some(kw => (symptoms || "").toLowerCase().includes(kw));
});

// Appointment type checks
engine.registerSignal("appointment.isRoutine", async ({ type }) => {
  return type === "routine" || type === "standard";
});

engine.registerSignal("appointment.isNewPatientType", async ({ type }) => {
  return type === "new_patient_registration" || type === "initial_consultation";
});

engine.registerSignal("appointment.requiresFasting", async ({ serviceType }) => {
  const fastingTypes = ["fasting_blood_test", "glucose_tolerance_test", "lipid_panel", "cholesterol_check"];
  return fastingTypes.includes(serviceType);
});

// Patient checks
engine.registerSignal("patient.isUnder16", async (args, { ctx }) => {
  // Check patient age from context or database
  return ctx.enduser?.metadata?.age < 16;
});

// Validation
engine.registerSignal("validation.nhsNumberInvalid", async ({ nhsNumber }) => {
  return !/^[0-9]{10}$/.test(nhsNumber || "");
});
```

---

## Subject Extractors

```typescript
// Extract patient from booking tools
engine.registerSubjectExtractor("book_appointment", (args) => {
  const patientId = args.toolArgs?.patient_id;
  if (!patientId) return [];
  return [{
    subjectType: "patient",
    role: "primary",
    value: patientId,
    idSystem: "practice_patient_id",
  }];
});

// Extract patient from lookup tools
engine.registerSubjectExtractor("lookup_patient", (args) => {
  const nhsNumber = args.toolArgs?.nhs_number;
  if (!nhsNumber) return [];
  return [{
    subjectType: "patient",
    role: "primary",
    value: nhsNumber,
    idSystem: "nhs_number",
  }];
});
```
