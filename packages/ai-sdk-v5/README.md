# Handlebar for AI SDK v5

Add [Handlebar] runtime checks, controls and governance into the Vercel AI SDK `>= 5.0.0`.\
This package provides a wrapper around the `Experimental_Agent` class
which allows you to configure runtime governance checks on your agent.
Support for earlier versions is in development.

_Note: This package in early development and the interface is subject to change._

## Features

Short-term roadmap:

- [X] Rule engine for allow/block tools, based on:
  - [X] user category
  - [X] rule category
- [X] Tool ordering + execution time checks
- [X] custom checks for rules (numeric tracking; boolean evaluation)
- [X] Audit telemetry + consumers
- [ ] Agent lockdown + human-in-the-loop actions

### Roadmap

Handlebar is in early development. We have a lot of functionality planned,
but need your feedback on what you need to help you build better agents.

- Refer to the [roadmap][root_roadmap] to see what we're cooking.
- Please feel free to [open an issue](https://github.com/gethandlebar/handlebar-js/issues/new) if you have any feedback or suggestions
- or [join our Discord][discord_invite] to talk to us directly

See [contributing][root_contributing] for more information.

## Getting started

Install the package in your codebase

```bash
bun add @handlbar/ai-sdk-v5
# or
npm i @handlebar/ai-sdk-v5
```

The package provides a drop-in replacement wrapper for the `Experimental_Agent` with `HandlebarAgent`

```diff
- import { Experimental_Agent as Agent } from 'ai';
+ import { HandlebarAgent } from '@handlebar/ai-sdk-v5';

- const agent = new Agent({
+ const agent = new HandlebarAgent({
system,
model,
tools,
});

const result = await agent.generate({ prompt: "Surprise me" });
```

The `HandlebarAgent` agent has the same interface as the ai-sdk's agent class,
so no further changes are necessary.
By default, the handlebar agent enforces no governance rules,
but does collect agent telemetry which can be exported to analyse your agent's behaviour.
To get more out of handlebar,
you can configure rules on tool use and behaviour
for handlebar to enforce at runtime.

### Audit logs

The `HandlebarAgent` collects audit logs for key events
in the lifetime of an agent run,
such as tool usage
and agent rule evaluations
(see below for more on Handlebar rules).

You can export the logs to a local dashboard
with [Handlebar lens][lens_repo],
our opensource agent manager which is in early development.
To do so,
set the endpoint environment variable
in your system running the `HandlebarAgent` class
and then run **Handlebar Lens** (refer to [Lens' README][lens_repo] for this).
Your agents logs will appear in the dashboard.

```bash
// .env
HANDLEBAR_ENDPOINT=http://localhost:7071/ingest
// or use port configured on Handlebar Lens
```

N.b. Handlebar audit logs and **Lens** are in early and active development.
Our near-term priorities include:

- Combining audit logs with OTEL for LLMs and agents
- Search, filtering, and run analysis on **Lens**

### Rules and agent enforcement

```js
import { HandlebarAgent } from "@handlebar/core";
import { and, block, configToRule, maxCalls, rule, sequence, toolName } from "@handlebar/core";
const rules = [
	// Block issueRefund requests after the first one.
	rule.pre({
		priority: 2,
		if: maxCalls({
			selector: { by: "toolName", patterns: ["issueRefund"] },
			max: 1,
		}),
		do: [block()],
	}),
  
	// Only allow issueRefund if humanApproval has been sought.
	rule.pre({
		priority: 10,
		if: and(
			toolName.eq("issueRefund"),
			sequence({ mustHaveCalled: ["humanApproval"] }),
		),
		do: [block()],
	}),
].map(configToRule);

const toolCategories = {
  tool1: ["pii"],
  tool2: ["some", "custom", "values"],
}

const agent = new HandlebarAgent({
	system,
	model,
	tools,
	governance: {
		userCategory: "admin",
		categories: toolCategories,
		rules,
	},
});
```

Please refer to [`./examples/`][examples] for a runable demo of [Handlebar]
applied to an ai sdk agent.\
N.b. Our developer docs are incoming.

## Contributing

We welcome contributions from the community: bug reports, feedback, feature requests.
Please refer to [CONTRIBUTING.md][root_contributing]
for ways you can help,
and guidelines.

## About Handlebar

Find out more at https://gethandlebar.com

[handlebar]: https://gethandlebar.com
[root_roadmap]: https://github.com/gethandlebar/handlebar-js/blob/main/ROADMAP.md
[root_contributing]: https://github.com/gethandlebar/handlebar-js/blob/main/CONTRIBUTING.md
[examples]: https://github.com/gethandlebar/handlebar-js/blob/main/examples/ai-sdk-v5/
[discord_invite]: https://discord.gg/Q6xwvccg
[lens_repo]: https://github.com/gethandlebar/lens
