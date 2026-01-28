# Uploading agent rules to Handlebar

The Handlebar API provides a route to upload a policy and its associated rules.

A policy is a group of rules with a selector to apply the policy's rules to agents (i.e. define an agent slug glob).

A rule defines:
- `selector`: quick-to-execute filtering logic to determine if a rule is in play. Currently based only on tool names or tags.
- `condition`: The logical evaluation of the rule
- `effect`: the single consequence if the rule condition is evaluated as true

Rule effects:
- allow: The tool call and agent can continue.
- block: The tool call is blocked.
- hitl: A human-in-the-loop request is made (actioned on the Handlebar platform), the tool call is blocked and the agent run exits.

**Route**: `POST https://api.gethandlebar.com/v1/rules`
**Authorization**: Bearer token (API key configured on the Handlebar platform)
**Body**:

```
{
  policy: {}
}
```
