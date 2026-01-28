# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Claude Code Skill

This repository includes a Claude Code skill for integrating Handlebar into AI agents. Use `/handlebar` to invoke it.

**Skill location**: `.claude/skills/handlebar.md`

The skill automates:
- Framework detection (Vercel AI SDK, LangChain, LlamaIndex, custom)
- Package installation
- Tool categorization
- Rule generation based on domain (healthcare, finance, e-commerce, HR)
- Integration code scaffolding

## Project Overview

Handlebar is an agentic governance runtime for AI agents. This repository contains JavaScript/TypeScript SDKs that add auditability, governance, and trust to AI agents built with popular frameworks like Vercel AI SDK.

## Repository Structure

This is a **Bun monorepo** with workspaces:

```
packages/
├── core/              # @handlebar/core - Framework-agnostic governance engine
├── ai-sdk-v5/         # @handlebar/ai-sdk-v5 - Vercel AI SDK v5+ integration
└── governance-schema/ # @handlebar/governance-schema - Shared types and schemas

examples/
└── ai-sdk-v5/         # Example implementations
```

## Common Commands

```bash
# Install dependencies
bun install

# Run all tests across workspaces
bun run test

# Run tests for a specific package
cd packages/core && bun test

# Lint the codebase
bun run lint

# Format code
bun run format

# Build a specific package
cd packages/<package> && bun run build
```

## Architecture

### Core Concepts

- **GovernanceEngine** (`packages/core/src/engine.ts`): The main class that evaluates rules against tool calls. Handles `beforeTool` and `afterTool` lifecycle hooks.
- **Rules**: JSON-defined governance policies with conditions and effects (allow/block/hitl)
- **Conditions**: Composable rule conditions (toolName, toolTag, enduserTag, executionTime, sequence, maxCalls, timeGate, signal, etc.)
- **Signals**: Custom evaluation functions registered via `registerSignal()`
- **Subjects**: Entity references extracted from tool calls via `registerSubjectExtractor()`
- **Audit Bus**: Event emission system for logging governance decisions

### Key Files

- `packages/core/src/engine.ts` - GovernanceEngine class with rule evaluation logic
- `packages/core/src/types.ts` - Core type definitions
- `packages/governance-schema/src/rules/` - Rule and condition type definitions
- `packages/ai-sdk-v5/src/agent.ts` - Vercel AI SDK integration

## Code Style

- **Formatter**: Biome with tabs for indentation, double quotes for strings
- **Linting**: Biome with recommended rules; `noExplicitAny` is a warning
- **Module format**: ESM (`"type": "module"`)
- **Build output**: Dual CJS/ESM via custom build.ts scripts

## Testing

Tests use Bun's built-in test runner:

```bash
bun test                    # Run tests in current package
bun run --filter '*' test   # Run all workspace tests
```

## Dependencies

- **zod**: Schema validation (v4.x)
- **ai**: Vercel AI SDK peer dependency for ai-sdk-v5 package
- **uuidv7**: UUID generation

## Development Notes

- Package versions are currently at `0.0.6-dev.x` (pre-release)
- The `mode` option in GovernanceConfig can be "monitor" (log only) or "enforce" (block violations)
- HITL (Human-in-the-loop) rules query an external API for approval status
