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
- [ ] Audit telemetry + consumers
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
bun i @handlbar/ai-sdk-v5
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
but does collect agent telemetry which can be exported to analyse your agent's behaviour*.
To get more out of handlebar,
you can configure rules on tool use and behaviour
for handlebar to enforce at runtime.

```js
import { HandlebarAgent } from "@handlebar/core";
import { Pred, type Rule, RuleBuilder } from "@handlebar/core";

const rules: Rule[] = [
  // Allow usage of tools tagged "pii" if the user category is "admin" or "dpo".
	new RuleBuilder("allow-pii-read-for-admin-dpo")
		.when(Pred.and(Pred.toolInCategory("pii"), Pred.userIn(["admin", "dpo"])))
		.allow("PII read permitted to admin/dpo")
		.build(),

  // Default block tools tagged with "pii".
	new RuleBuilder("block-pii-read-otherwise")
		.when(Pred.and(Pred.toolInCategory("pii")))
		.block("PII read forbidden for this user")
		.build(),
];

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

*_telemetry export functionality is WIP._

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
