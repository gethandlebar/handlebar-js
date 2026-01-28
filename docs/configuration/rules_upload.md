# Uploading agent rules to Handlebar

The Handlebar API provides a route to upload a policy and its associated rules.
Refer to the documentation on rules and policies before evaluating this API route.

**Route**: `POST https://api.gethandlebar.com/v1/rules`
**Authorization**: Bearer token <API key as configured on the Handlebar platform>
**Body**:
```
{
  policy: PolicySpec,
  rules: RuleSpec[]
}
```

**IMPORTANT:** This route does not handle duplication/upserts. If it is invoked again with the same policy/rules, duplicate policies/rules will be created.

## Evaluation and execution script

To validate generated policies and rules:
- Install necessary dependencies: `npm i --save-dev @handlebar/governance-schema zod`
- Run the following script, filling in <policySpec> and <ruleSpec> placeholders with your actual data

```typescript
import { RuleSpecSchema, PolicySpecSchema } from "@handlebar/governance-schema";
import { z } from "zod";

const HandlebarRulesPostSpec = z.object({
  policy: PolicySpecSchema,
  rules: RuleSpecSchema.array()
});

const validData = HandlebarRulesPostSpec.parse({
  policy: <policySpec>,
  rules: <ruleSpec>
});

await fetch('https://api.gethandlebar.com/v1/rules', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.HANDLEBAR_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(validData)
});
```
