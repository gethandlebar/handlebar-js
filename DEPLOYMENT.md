# Deploying Handlebar into an AI Agent

The deployment documentation has been reorganized for easier navigation and Claude Code skill integration.

## Claude Code Skill

Use the included skill for automated integration:

```
/handlebar
```

**Install for personal use (all projects):**

```bash
mkdir -p ~/.claude/skills
curl -o ~/.claude/skills/handlebar.md https://raw.githubusercontent.com/gethandlebar/handlebar-js/main/.claude/skills/handlebar.md
```

Or clone this repo - the skill is included at `.claude/skills/handlebar.md`.

## Quick Links

| Topic | Location |
|-------|----------|
| **Main Guide** | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| **Framework Guides** | [docs/frameworks/](docs/frameworks/) |
| **Rule Reference** | [docs/rules/README.md](docs/rules/README.md) |
| **Domain Templates** | [docs/rules/](docs/rules/) |

## Framework Integration

- [Vercel AI SDK](docs/frameworks/vercel-ai-sdk.md) - Recommended for AI SDK users
- [LangChain](docs/frameworks/langchain.md) - LangChain JS integration
- [LlamaIndex](docs/frameworks/llamaindex.md) - LlamaIndex TS integration
- [Custom / Direct SDK](docs/frameworks/custom.md) - OpenAI, Anthropic, Google SDKs

## Domain-Specific Rules

- [Healthcare](docs/rules/healthcare.md) - Patient services, appointments, clinical
- [Finance](docs/rules/finance.md) - Transactions, accounts, compliance
- [E-commerce](docs/rules/ecommerce.md) - Orders, refunds, customer support
- [HR](docs/rules/hr.md) - Employee data, leave, payroll

## Getting Started

```bash
# For Vercel AI SDK
npm install @handlebar/ai-sdk-v5 @handlebar/core ai

# For all other frameworks
npm install @handlebar/core
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full guide.
