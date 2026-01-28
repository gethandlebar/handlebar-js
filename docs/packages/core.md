# Handlebar Core

- **Handlebar package:** `@handlebar/core`
- **Framework compatibility:** Agnostic

`core` provides the underlying logic for Handlebar:
- Runtime rule evaluation engine (exported from package as `GovernanceEngine`)
- Communicates with the Handlebar API (e.g. fetch rules, update agent identity)
- Emits audit event logs to Handlebar API

If using a framework-specific Handlebar SDK, you typically should not need to interact with `core` directly.
If you are implementing Handlebar for a framework which Handlebar does not directly support,
you patch the `GovernanceEngine` within the agent code to achieve the same result.
In addition to the following information on `GovernanceEngine`, you can review the `@handlebar/ai-sdk-v5` package for an example of `GovernanceEngine` can be integrated within an agent framework. 

## GovernanceEngine

Each specific agent framework implementation uses `GovernanceEngine` under the hood to evaluate rules.

### Configure agent rules

`GovernanceEngine.initAgentRules`

This method accepts configuration for the agent identity, the tools it uses, and fetches in-scope rules from the Handlebar API. It should be invoked once during agent initialisation.

Param spec:
```ts
initAgentRules(agentConfig: {slug: string; name?: string; description?: string; tags?: string[];}, tools: AgentTool[],)
```

Where:
```ts
type AgentTool = {
	name: string;
	key: string;
	version: number;
	kind: "function";

	description?: string;
	metadata?: Record<string, string>;
};
```

### Initialise runtime context

`GovernanceSchema.createRunContext`

This method accepts an ID for the agent run and an optional enduser on whose behalf the agent is acting.

```ts
createRunContext(
		runId: string,
		opts?: {
			initialCounters?: Record<string, number>;
			enduser?: EndUserConfig & { group?: EndUserGroupConfig };
		},
		now = () => Date.now(),
): RunContext
```

Where:
```ts
type EndUserConfig = {
	externalId: z.string(), // A Handlebar user's ID for _their_ user, as present in their systems.
	metadata: Record<string, string>, // Arbitrary labels to attach to the user.
	name?: string,
});

type EnduserGroupConfig = EndUserConfig
```

The run context object it returns should be retained and passed into subsequent methods.

### Evaluate rules before a tool executes

`GovernanceEngine.beforeTool`

This method accepts the run context and tool to be invoked. It evaluates Handlebar rules against this request and returns a rule result.
It also emits a `tool.decision` event, containing information on evaluated rules.

```ts
async beforeTool(
	ctx: RunContext<T>,
	toolName: string,
	args: unknown,
): Promise<GovernanceDecision> 
```

### Evaluate rules on a tool's output

`GovernanceEngine.afterTool`

This method evaluates rules that execute after a tool has completed execution.
It also emits a `tool.result` event, containing information on the tool's input/output.

```ts
async afterTool(
	ctx: RunContext<T>,
	toolName: string,
	executionTimeMS: number | null,
	args: unknown,
	result: unknown,
	error?: unknown,
): void
```

## Telemetry sinks and emit

```ts
import { emit } from "@handlebar/core";
````

The `emit` function sends audit events to any configured sinks.
This function is invoked internally within `GovernanceEngine` and by agent framework SDKs
to emit Handlebar audit events to configured sinks.

The `core` package initialises a `Telemetry` singleton which configures the sinks:
- HTTP sink to the Handlebar API if `HANDLEBAR_AUDIT_ENDPOINT` and `HANDLEBAR_API_KEY` environment variables are set
- Console sink otherwise

If emitting audit logs to the API, the `HANDLEBAR_AUDIT_ENDPOINT` should be set to `https://api.handlebar.ai/v1/audit/ingest`.
The `Telemetry` singleton is not currently exposed for user configuration.
