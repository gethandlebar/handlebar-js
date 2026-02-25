# Handlebar, Agent Control Layer 

[Handlebar] is a runtime control layer for your AI agents.

Enforce deterministic rules on your agents as they act,
so you can guarantee they don't violate your team's policies.

This package provides the policy and event types that Handlebar manages.

| Without Handlebar | With Handlebar |
|:------|:------|
| "Whoops the agent deleted prod DB" | Deterministically block dangerous tool actions. Full auditability into what your agent _tried_ to do.  |
| "Our costs are ballooning with no way to control them" | Track token usage and USD spend, and set hard limits on your agents. When the limit is reached, Handlebar can block the agent from taking further actions. |
| "Someone convinced the agent to leak another user's emails" | Limit tool permissions to the user. |
| "The agent is going off-the-rails and spamming heavy APIs" | Set rate limits on tool use and prevent runaway actions |
| "We can't be sure the agent isn't leaking sensitive data" | Enforce hard data boundaries between tools and your output. Filter PII before it leaks through agent context |

## Features

- Collects auditable event logs of your agent's actions
- Block dangerous tools use (e.g. `send_email(internalAddress) -> PASS | send_email(unknownperson@randomaddress.ru) -> BLOCK`)
- Block dangerous tool chaining (e.g. `get_pii` -> `send_slack_message -> BLOCK: risk of data exfil`)
- Require human reviews on dangerous actions
- Enforce hard cost budgets and token usage limits for your agents
- Track usage from each enduser and enforce per-user budgets
- Rate limit agent actions

## How it works

1. Wrap a Handlebar client (this codebase) around your agent
1. The client sends event logs of your agent's actions to the [Handlebar platform][platform], where you can analyse them
1. As your agent receives an action from the LLM, Handlebar intercepts and evaluates the proposed action against your configured policies
1. If there are violations, Handlebar either permits the action, blocks it, or exits the run

## Get started

You will need:

- an agent...
- Wrap your agent with a Handlebar client
- Connect to the [Handlebar platform][platform]
- Configure policies to enforce on your agent

### Wrap your agent with Handlebar

This repository is a monorepo containing installable packages
for different JS/TS agent building frameworks. We provide some pre-built wrappers for agent frameworks,
with more on the way soon. If your agent is not directly supported, you can still easily plug Handlebar into your agent.

| Framework | Install command | Where to read more |
|:---:|:---:|:---:|
| Vercel ai **Version 5** | `bun i @handlebar/ai-sdk-v5` | [Vercel AI integration guide](../docs/integrations/vercel-ai-sdk.md) |
| Vercel ai **Version >=6** | Soon... | |
| Langchain | Soon... it's still being tested 😕 | See the [langchain integration guide](../docs/integrations/langchain.md) |
| Openai agents | `bun i @handlebar/core` | See the [OpenAI integration guide](../docs/integrations/openai-agents.md)
| Other JS/TS, and custom agents | `bun i @handlebar/core` | [`packages/core`](../packages/core) |
| Python agents | Soon... | |

### Connect your agent to the Handlebar platform

The client SDKs interact with the Handlebar API to emit agent telemetry and event data it collects,
and to evaluate your configured policies.

Sign up at [`https://app.gethandlebar.com`][platform].\
If you are waitlisted, [get in touch](#get-in-touch) with us to get access.

Once on the platform, create an API key and activate your agent by setting the `HANDLEBAR_API_KEY` environment variable.

### Configure policies to enforce on your agent

On the [platform] you can create policies from simple templates: usage limits, dangerous tool use, GDPR, finance agents, and more.

Alternatively, run the Handlebar claude code skill to generate rules custom to your agent, by running:

```bash
npx skills add gethandlebar/agent-skills
```

Go to the [skill repository](https://github.com/gethandlebar/agent-skills)
for full instructions.

## Get in touch

Please [open an issue](https://github.com/gethandlebar/handlebar-js/issues/new) if you have any feedback, suggestions, or requests for framework support.
Alternatively, [book a call][calendar] to talk to us about how Handlebar could help to protect your team's agents.

## License

Apache 2.0 [`LICENSE`](../LICENSE).

[handlebar]: https://www.gethandlebar.com
[platform]: https://app.gethandlebar.com
[calendar]: https://calendly.com/arjun-handlebar/30min
[docs]: https://handlebar.mintlify.app
