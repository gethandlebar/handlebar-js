# Rules

A Handlebar "rule" is a logical condition evaluation on an agent's actions (history, state, tool requests and responses etc.). They are mostly evaluated client-side, with results sent Handlebar as immutable audit events. A rule contains:

- `selector`: quick-to-execute filtering logic to determine if a rule is in play. Currently based only on tool names or tags.
- `effect`: the single consequence if the rule condition is evaluated as true
- `condition`: The logical evaluation of the rule

The selector gates whether to evaluate: If it does not match, rule is skipped and the process continues. If the selector matches, the condition is evaluated. If the condition is matched, the effect is applied.

The complete spec for defining a new rule is:
```
{
	priority: number;
	enabled: boolean;
	name: string;
	selector: RuleSelector;
	condition: RuleCondition;
	effect: RuleEffect;
}
```

## Selector

```
{
	phase: "tool.before";
	tool?: {
		name?: string | string[]; // glob strings
		tagsAll?: string[];
		tagsAny?: string[];
	};
};
```

- If `tool` is not defined, there is no selector and so the rule will never be evaluated

## Effect

```
{ type: "allow"; reason?: string }
	| { type: "hitl"; reason?: string }
	| { type: "block"; reason?: string }
```

- `block` indicates that a tool call should be blocked from taking place, although agent execution may continue
- `hitl`: human-in-the-loop
  - A review request is sent on the Handlebar platform, where users can review, then approve or deny the action
  - Approving/denying does not automatically retry the agent, however subsequent invocations which match the rule will follow the approve/deny decision
  - A `hitl` will block the tool execution AND abort the agent run while the review is pending

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

### enduserTag

```
{ kind: "enduserTag"; op: "has"; tag: string }
| { kind: "enduserTag"; op: "hasValue"; tag: string; value: string }
| { kind: "enduserTag"; op: "hasValueAny"; tag: string; values: string[] }
```

### executionTime

```
{
	kind: "executionTime";
	scope: "tool" | "total";
	op: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
	ms: number;
}
```

### sequence

```
{
  kind: "sequence";
	mustHaveCalled?: string[]; // glob
	mustNotHaveCalled?: string[]; // glob
}
```

### maxCalls

```
{
	kind: "maxCalls";
	selector: { by: "toolName"; patterns: string[] } | { by: "toolTag"; tags: string[] }; // strings are globs
	max: number;
}
```

### metricWindow

```
{
  kind: "metricWindow";
	scope: "agent" | "agent_user";
	metric: { kind: "inbuilt"; key: "bytes_in" | "bytes_out" | "duration_ms" | "records_in" | "records_out" } | { kind: "custom"; key: string };
	aggregate: "sum" | "avg" | "max" | "min" | "count";
	windowSeconds: number;
	op: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
	value: number;
	filter?: { toolName?: string | string[]; toolTag?: string | string[] };
}
```

- bytes_in/out refers to data into and out of a tool
- duration_ms is total agent execution time in milliseconds
- records_in/out evaluates number of rows in data in/out of a tool, if data is array-like

### timeGate

```
{
  kind: "timeGate";
	timezone: { source: "enduserTag"; tag: string; fallback?: "org" };
	windows: {
		days: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
		start: string;
		end: string;
	}[];
}
```

- `windows > start` and `windows > end` are time-strings
- `timezone > tag` indicates the tag/metadata on the enduser which indicates their timezone
- If enduser timezone tag is not found, the rule will not be evaluated

### signal

```
SignalBinding = { from: "enduserId" }
	| { from: "enduserTag"; tag: string }
	| { from: "toolName" }
	| { from: "toolTag"; tag: string }
	| { from: "toolArg"; path: string } // Dot-path to argument
	| {
			from: "subject";
			subjectType: string;
			role?: string; // e.g. "primary" | "source" | "dest". For when they are multiple items within a subject type.
			field?: "id" | "idSystem";
	  }
	| { from: "const"; value: string } // valid JSON string

// signal condition:
{
  kind: "signal";
	key: string;
	args: Record<string, SignalBinding>;
	op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "nin";
	value: string; // valid JSON string
}
```

- Requires a signal-generating function to be registered client-side with the corresponding `key`
- `args` denotes the parameters passed into the signal-generating function. The signal bindings will be evaluated into their values before being passed into the function
- `GovernanceEngine` from `@handlebar/core` has a `registerSignal` method to assign a signal-generating function to a key
- `subjects` are also defined client-side. A subject-generating function will run on the attached tool and provide additional data on the "subject" of the tool (e.g. the human subject) which is not visible from tool args alone

In typescript, signal-generating functions must satisfy:
```ts
type SignalProvider<TValue = unknown> = (
	args: Record<string, unknown>,
) => TValue | Promise<TValue>;
```

and added to the `GovernanceEngine` instance via:
```ts
registerSignal(key: string, provider: SignalProvider)
```

Subject-generating functions must satisfy:
```ts
type SubjectRef = {
  subjectType: string;
  value: string;
  role?: string | undefined;
  idSystem?: string | undefined;
};

type SubjectExtractor<T extends Tool = Tool> = (args: {
	tool: ToolMeta<T>;
	toolName: string;
	toolArgs: unknown;
	runContext: RunContext<T>;
}) => SubjectRef[] | Promise<SubjectRef[]>;
```

and added to the `GovernanceEngine` instance via:
```ts
registerSubjectExtractor(toolName: string, extractor: SubjectExtractor);
```

### and

```
{ kind: "and"; all: RuleCondition[] }
```

### or

```
{ kind: "or"; any: RuleCondition[] }
```

### not

```
{ kind: "not"; not: RuleCondition }
```
