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
- Register agent as normal
- Register tools (this may need to be a separate api call)
- Some process to fetch "aliveness" of agent (i.e. should it run at all? or has a lockdown been placed on it) and list of applied policies (enabled and disabled, or dry-run). Should this be the result of the agent register call?
- Running a policy check (`/v1/agents/check`) with agentId and policies.
- Regular polling for metric rule violations, as is currently in place

## Integration with frameworks
The core design MUST be easy for users to wrap into their own agents, regardless of framework used (or none).
When planning the design, look up vercel ai v6, langchain js, and openai agents sdk for typescript. Map out how a user would integrate the Handlebar core pattern into their agents built with these frameworks, to identify potential DX or other bottlenecks.
