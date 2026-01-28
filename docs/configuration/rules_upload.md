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
