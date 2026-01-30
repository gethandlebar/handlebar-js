# Handlebar Core

Core, framework-agnostic logic for building [Handlebar] governance into your agents.

## Features

- Rule engine to enforce agent behaviours at runtime
- Audit telemetry + consumers (sends events to Handlebar [platform])

### Roadmap

Handlebar is in early development. We have a lot of functionality planned,
but need your feedback on what you need to help you build better agents.

- Please feel free to [open an issue](https://github.com/gethandlebar/handlebar-js/issues/new) if you have any feedback or suggestions
- or [join our Discord][discord_invite] to talk to us directly

See [contributing][root_contributing] for more ways to get in touch and help.

## Getting started

The core package should be used alongside a framework-specific Handlebar SDK,
such as [ai-sdk-v5].
Refer to that package's README for more information.

`@handlebar/core` exposes core primitives for building rules and a governance runtime.
In particular, it defines "rules" to enforcing tool-use behaviour based on information like
a tool's category, the user on who's behalf the agent is acting, and tool use parameters.

**N.b. Our developer docs are incoming.**

## Contributing

We welcome contributions from the community: bug reports, feedback, feature requests
Please refer to [CONTRIBUTING.md][root_contributing]
for ways you can help,
and guidelines.

## About Handlebar

Find out more at [https://gethandlebar.com][handlebar]

[handlebar]: https://gethandlebar.com
[root_contributing]: https://github.com/gethandlebar/handlebar-js/blob/main/CONTRIBUTING.md
[examples]: https://github.com/gethandlebar/handlebar-js/blob/main/examples/ai-sdk-v5/
[discord_invite]: https://discord.gg/Q6xwvccg
[platform]: https://app.gethandlebar.com
[ai-sdk-v5]: https://github.com/gethandlebar/handlebar-js/blob/main/packages/ai-sdk-v5/
