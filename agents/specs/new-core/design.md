## Proposed interaction
Keep end-user API tiny. user calls:
- const hb = Handlebar.init(<global config>)
- const run = hb.startRun(<run specific config>)
- run.<lifecyclehook>
- run.end(status?)

The idea is to pass explicitly run around, but the `hb` having optional ASynclocalstorage managers
for flows which require it, e.g. a `withRun(run, fn)` wrapper. Handlebar-managed thin framework wrappers might likely use ALS instead.

### HandlebarClient
HandlebarClient initted with config on failclosed mode (false - default - or true), enforce mode (enforce, shadow - run and log but don't enforce - and off - don't eval policies at all).
The client can be initted with agent information (in existing shape) and enduser shape (in existing shape), which if provided will propagate down to run. Run can also accept enduser config.
HandlebarClient stores global and per-run context. Per-run context can be handled by asynclocalstorage, but also provides a `Run` producer (returns a run object and passes down global config).

### Run
config:
```
hb: HandlebarClient<TContext>;
runId: string;
sessionId?: string;
actor?: Actor; // enduser - should we use enduser or actor?
tags?: Record<string, string>;
context: TContext;
runTtlMs: number; // Lifetime after which the run is auto-closed. designed to provide an end for when users have forgotten to invoke run.end
```

Run stores current state, a log of evaluated events (regardless of outcome), and whether the process should be exited (e.g. a Handlebar rule violation means the agent should stop).
Run constructor emits sinks with run.started event. `end` method emits run.ended event to sinks. `beforeTool` hook checks policies and emits tool.decision as relevant. `afterTool` checks . `beforeLlm` and `afterLlm` hooks should update stored token metrics and have a surface for PII redaction for when it's implemented.
We need some wrap to wrap tools to allow users to define tags and classification of tools.

### Sinks
- http sink with bounded queue, retry and backoff
- console sink
- default configuration is HTTP sink to the primary handlebar api endpoint (https://api.gethandlebar.com), and api key access at HANDLEBAR_API_KEY env; although it can be configured with a different endpoint

### API
Centralised api manager which handles all interactions with Handlebar api, including the Http Sink. API flow is slightly different to current process:
- `PUT /v1/agents/{agent-slug}` -  Same api as currently (although tools might not necessarily be provided at that time), but with a new path. Returns agent ID.
- `PUT /v1/agents/{agent_id}/tools` - Register tools on agent, as currently exists in the agent registry
- `POST /v1/agents/{agent_id}/preflight` - Checks aliveness of agent. Returns `{ lockdown: { status: boolean, reason?: string, until_ts: null | number }, budget: BudgetGrantResponse | null }`
- `POST /v1/agents/{agent_id}/metrics` - Regular polling for metric budgets, as is currently in place
- `POST /v1/runs/{run_id}/evaluate` - Send agent ID, which the server will fetch active rules for, evaluate and return a decision object*. N.b. the `run_id` here is the client-side generated run ID, not a PK from a server table (unlike `agent_id`)
- `POST /v1/runs/{run_id}/events` Run events - the current "audit" ingest, but with a new route

#### Decision object
Returned from server
```
type Verdict = "ALLOW" | "REWRITE" | "BLOCK" | "HITL"; // On the action/tool use
type RunControl = "CONTINUE" | "TERMINATE" | "PAUSE"; // On the agent process. I.e. "TERMINATE" should end the agent run.

type Cause =
  | { kind: "RULE_VIOLATION"; ruleId: string; matchedRuleIds?: string[] }
  | { kind: "HITL_PENDING"; approvalId: string; ruleId?: string }
  | { kind: "LOCKDOWN"; lockdownId?: string; ruleId?: string }

type RuleEval = {
  ruleId: string;
  enabled: boolean;
  matched: boolean;
  violated: boolean;
  // optional: which predicate matched, score, etc.
};

type Decision = {
  verdict: Verdict;
  control: RunControl;

  // Machine-readable why
  cause: Cause;

  // Human-readable details
  message: string;

  // Provenance
  finalRuleId?: string;          // rule that produced final verdict (if any)
  evaluatedRules?: RuleEval[];   // optional, can be sampled
  matchedRuleIds?: string[]; // Do we need these if info is present in RuleEval?
  violatedRuleIds?: string[];
};
```

The api manager and main core should handle an unresponsive api, with appropriate logic handling according to the failclosed config option.

## "Audit" events
Use the existing event schemas in `@handlebar/governance-schema` (packages/governance-schema). However, changes may need to be made (e.g. with new decision/verdict scope and new agent flow). in which case, made a proposal in this document.

## Integration with frameworks
The core design MUST be easy for users to wrap into their own agents, regardless of framework used (or none).
When planning the design, look up vercel ai v6, langchain js, and openai agents sdk for typescript. Map out how a user would integrate the Handlebar core pattern into their agents built with these frameworks, to identify potential DX or other bottlenecks.
