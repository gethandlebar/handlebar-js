# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands use **Bun** as the runtime and package manager.

```bash
# Install dependencies
bun install

# Run all tests across all packages
bun run test

# Run tests for a specific package
cd packages/core && bun test
# or run a single test file
bun test packages/core/test/engine.test.ts

# Build all packages (run from each package dir or via filter)
bun run --filter '*' build

# Build a specific package
cd packages/core && bun run build.ts && tsc -p tsconfig.json

# Lint
bun run lint

# Format (writes in place)
bun run format
```

Build output goes to each package's `dist/` directory (ESM `.js` + `.d.ts` type declarations).

## Code Style

- Biome is the linter/formatter. Config in `biome.json` — tabs for indentation, double quotes for JS strings, auto-organized imports.
- `noExplicitAny` is a warning (not error); biome-ignore comments are used where needed.

## Architecture

This is a **Bun workspace monorepo** with three publishable packages under `packages/`:

### `@handlebar/governance-schema`
Zod schemas and TypeScript types for all governance domain objects: `Rule`, `RuleCondition`, `GovernanceDecision`, `AuditEvent`, `PolicySpec`, `EndUserConfig`. This package has no runtime dependencies on the other packages — it's the shared contract layer.

### `@handlebar/core`
Framework-agnostic governance engine. Key concepts:

- **`GovernanceEngine`** (`src/engine.ts`) — the central class. Wraps agent tool calls with `beforeTool` / `afterTool` lifecycle hooks. Evaluates rules against tool calls and produces `GovernanceDecision` objects with effects: `allow | block | hitl`. Decisions are ranked by severity (block > hitl > allow).
- **Rule evaluation** — rules have a `selector` (phase + tool name/tags), a `condition` (a tree of `RuleCondition` nodes), and an `effect`. Conditions include: `toolName`, `toolTag`, `toolArg`, `enduserTag`, `maxCalls`, `sequence`, `executionTime`, `timeGate`, `requireSubject`, `signal`, `metricWindow`, and logical `and/or/not`.
- **`SignalRegistry`** (`src/signals.ts`) — pluggable async signal providers. Rules can reference named signals with bound arguments (from tool args, enduser tags, subjects, etc.) and compare their output.
- **`SubjectRegistry`** (`src/subjects.ts`) — extracts typed "subjects" (entities acted upon) from tool calls; used in `requireSubject` conditions.
- **`BudgetManager`** (`src/budget-manager.ts`) — tracks rolling metric windows from the API for `metricWindow` conditions.
- **`ApiManager`** (`src/api/manager.ts`) — communicates with the Handlebar API (`HANDLEBAR_API_ENDPOINT`, default `https://api.gethandlebar.com`). On startup calls `PUT /v1/agents` (upsert), fetches rules from `/v1/rules/agent/:id`, evaluates metric budgets at `/v1/agents/:id/metrics/budget`, and queries HITL status at `/v1/audit/hitl`.
- **Audit subsystem** (`src/audit/`) — emits `AuditEvent` objects via a `Telemetry` singleton bus. Events are keyed by `kind` (e.g. `run.started`, `tool.decision`, `tool.result`, `llm.result`, `message.raw.created`) and carry `runId`, `stepIndex`, `enduserExternalId`.

### `@handlebar/ai-sdk-v5`
Vercel AI SDK v5 adapter. Exports **`HandlebarAgent`** (`src/agent.ts`), a wrapper around `Experimental_Agent` that:
1. Instantiates a `GovernanceEngine` with tool metadata derived from the AI SDK toolset.
2. Wraps each tool's `execute` function to call `beforeTool` / `afterTool` around the real execution.
3. Injects a `stopWhen` condition that halts the agent loop when `HANDLEBAR_EXIT_RUN_CODE` appears in tool output (triggered by `hitl` decisions).
4. Emits `run.started`, per-step LLM token usage, and message events.

Usage pattern:
```ts
const agent = new HandlebarAgent({ model, tools, governance: { rules: [...] }, agent: { slug: "my-agent" } });
await agent.generate("Do the thing");
```

### Environment variables
- `HANDLEBAR_API_KEY` — required for API integration (rules fetching, HITL, metrics).
- `HANDLEBAR_API_ENDPOINT` — optional override for the API base URL.

### Package dependency graph
```
governance-schema   (no internal deps)
    ↑
  core              (depends on governance-schema)
    ↑
ai-sdk-v5           (depends on core + governance-schema, peer dep on ai@^5)
```
