# Handlebar for AI SDK v5

Add [Handlebar] runtime checks, controls and governance into the Vercel AI SDK `^5.0.0`.\
This package provides a wrapper around the `Experimental_Agent` class
which allows you to configure runtime governance checks on your agent.
Support for earlier versions is in development.

_Note: `ai@6` support is coming soon_

## Features

Short-term roadmap:

- [X] Rule engine for allow/block tools, based on:
  - [X] user category
  - [X] rule category
- [X] Tool ordering + execution time checks
- [X] custom checks for rules (numeric tracking; boolean evaluation)
- [X] Audit telemetry + consumers
- [X] human-in-the-loop actions
- [ ] Agent lockdown

### Roadmap

Handlebar is in early development. We have a lot of functionality planned,
but need your feedback on what you need to help you build better agents.

- Please feel free to [open an issue](https://github.com/gethandlebar/handlebar-js/issues/new) if you have any feedback or suggestions
- or [join our Discord][discord_invite] to talk to us directly

See [contributing][root_contributing] for more information.

## Getting started

### Handlebar setup

1. Sign-up at [`https://app.gethandlebar.com`](https://app.gethandlebar.com) (get in touch with us if you're on the waitlist and want access)
1. Org > settings > API Keys > Create API Key
1. Copy this API key and add to your agent codebase's `.env` file as `HANDLEBAR_API_KEY=<key>`

### Agent setup

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

### Auditable decision logs

The `HandlebarAgent` collects logs for key events
in the lifetime of an agent run,
such as tool usage
and agent rule evaluations
(see below for more on Handlebar rules).
When your agent runs,
Handlebar will automatically emit key events to the [platform].

### Enforce Rules on the Agent

Rules are configured on the Handlebar platform,
or run the Claude Code skill (**coming soon**)
to set up in your codebase.

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
[platform]: https://app.gethandlebar.com
