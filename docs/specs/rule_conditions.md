# Rule conditions and selectors

A Handlebar "rule" is a logical condition evaluation on an agent's actions (history, state, tool requests and responses etc.). They are mostly evaluated client-side, with results sent Handlebar as immutable audit events. A rule contains:

- `selector`: quick-to-execute filtering logic to determine if a rule is in play. Currently based only on tool names or tags.
- `condition`: The logical evaluation of the rule
- `effect`: the single consequence if the rule condition is evaluated as true

## Conditions

| Dimension | Key | Purpose | Notes |
| --------- | ---- | ------ | ----- |
| Enduser tags | `enduserTag` | Evaluate a given metadata tag for the active enduser (entity on whose behalf the agent is acting) | Enduser information and metadata must be provided when configuring Handlebar on the agent |
| Tool or agent execution time | `executionTime` | Set hard limits on total or per-tool execution time in MS | |
| Sequencing of tool usage | `sequence` | Require that certain tools are called before tool X is allowed, or block usage of X if tool Y has been invoked | |
| Limit number of calls to a tool | `maxCalls` | Set a hard cap on the number of times a matching tool can be invoked in any run | Currently can only be scoped to the current run, and is agnostic to tool parameters |
| Evaluation of a metric in a time window | `metricWindow` | Evaluate a given metric against a threshold in a time period. Can be scoped across the agent's runs or specific to the enduser.  | Handlebar tracks metrics around execution time and tool in/out bytes. Custom metrics can be defined, but require additional config when integrating Handlebar with the agent |
| Timezone limited execution | `timeGate` | Limit agent capabilities to certain times or days, based on the enduser's timezone | |
| Evaluation of a custom signal | `signal` | Evaluate a "signal" (custom code you define locally) | Requires additional configuration when integrating Handlebar with the agent |
| Logical And | `and` | Require that all of the given conditions are met | |
| Logical Or | `or` | Require that at least one of the given conditions is met | |
| Logical Not | `not` | Invert the result of a given condition | |
