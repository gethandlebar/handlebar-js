# Refactor core
We want to refactor `@handlebar/core` (packages/core) to improve the DX and make it trivial to integrate into custom agents and frameworks by a developer _without_ needing a Handlebar-built thin wrapper around a framework. This has some differences from the current implementation:
- The main process should expose clear lifecycle hooks to the user, which can in turn be plugged into a framework's lifecycle hooks
- All sink emitters should happen within core, _not_ thin wrappers (as currently happens in `@handlebar/ai-sdk-v5`)
- Sinks are configurable
- The process of initing Handlebar is separating from initing a run.
- Logic for evaluation is going to be moved to a running server (Handlebar cloud or an open-core), which the core calls via the api manager, at `/v1/agent/rule/evaluate` route
- Removing outdated developer cruft, e.g.:
  - the duplicated run context objects
  - core's expected tool shape should no longer implicitly rely on vercel ai-like tool shape

N.b. work should be done in `packages/core/src/new_core`. Create new unit tests for `new_core` as you go along. We will migrate core to new_core after complete and successful.

N.b. "run" is a single loop of an agent. Runs can optionally belong to a session (provided via ID), with many runs to a session.

## Requirements
- Easy shared config/init
- Ability to have concurrent agent runs without bleeding context
- Developer has to invoke a couple of easy lifecycle methods to connect to their agents: little config or handling outputs necessary
- Hard separation of global vs per-run state, with Async-safe context propagation
- Idempotent lifecycle (e.g. calling run start twice should be idempotent)
- Failure semantics are explicit (explicit failopen vs failclose in config init)
- Typed, ergonomic context (no defaulting to "any")
- Low overhead
  - sync path fast
  - network async/batched
  - local decision cache
  - background flush with bounded queue
- Redaction boundaries
  - Currently don't support PII redaction of LLM input/output and tool input/output, but that should be supported soon, so the core should be rebuilt with this functionality in mind.

## Process
- refer to `design.md` for a proposed specification. As we iterate, update the design file.
- update `plan.md` with a checklist of proposed and completed actions, in logical order. Add useful context about components and implementation details to that file. If you have any design questions, add them to the file and ask the user; update the file with the answers.
