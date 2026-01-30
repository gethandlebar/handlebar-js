# Handlebar JavaScript SDK

JavaScript SDKs for implementing [Handlebar], the agentic governance runtime.\
Supports popular agent frameworks, such as Vercel AI sdk.

- Generate auditable decision logs of your agent's actions
- Enforce rules on your agent behaviour at runtime, based on tool use, LLM context, historic user actions, and more
- Block agent actions or trigger human-in-the-loop reviews on the [Handlebar] platform 

## Project structure

This repository is a monorepo containing installable packages
for different JS/TS agent building frameworks.

- [`@handlebar/ai-sdk-v5`](./packages/ai-sdk-v5) - Handlebar for the Vercel AI SDK `^5.0.0`.
- [`@handlebar/core`](./packages/core) - contains framework-agnostic logic for evaluating agent rules.
- [`@handlebar/governance-schema`](./packages/governance-schema) - Canonical governance decision events and rule schemas.

For each package,
check out its README.

Frameworks coming soon:
- langchain (+ for python, not in this repository)
- crew
- llamaindex
- openai
- ...and your favourite (open an issue requesting it and we'll add it to the roadmap)

## How-to

To get started, refer to the READMEs in each sub-package.\
**Coming soon:** We are working on a claude code skill that will automatically configure Handlebar on your agent.

## Roadmap

Handlebar is in early development. We have a lot of functionality planned,
but need your feedback on what you need to help you build better agents.

- Please feel free to [open an issue](https://github.com/gethandlebar/handlebar-js/issues/new) if you have any feedback or suggestions
- or [join our Discord][discord_invite] to talk to us directly

## Contributing

We welcome contributions from the community: bug reports, feedback, feature requests
Please refer to [CONTRIBUTING.md](./CONTRIBUTING.md)
for ways you can help,
and guidelines.

## License

These SDKs defined under [`packages/`](./packages/)
are currently licensed under [`LICENSE`](./LICENSE).

[handlebar]: https://www.gethandlebar.com
[discord_invite]: https://discord.gg/Q6xwvccg
[docs]: https://handlebar.mintlify.app
