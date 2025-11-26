# Handlebar JavaScript SDK

JavaScript SDKs for implementing [Handlebar], the agentic governance runtime.\
Supports popular agent frameworks, such as Vercel AI sdk.

## About

## Project structure

This repository is a monorepo containing installable packages
for different JS/TS agent building frameworks.

- [`@handlebar/ai-sdk-v5`](./packages/ai-sdk-v5) - Handlebar for the Vercel AI SDK `>= 5.0.0`.
- [`@handlebar/core`](./packages/core) - contains framework-agnostic logic for building rules.

For each package,
check out its specific README.

Frameworks coming soon:
- langchain (+ for python, not in this repository)
- crew
- llamaindex
- openai
- ...and your favourite (open an issue requesting it and we'll add it to the roadmap)

## How-to

Check out the [`./examples/`](./examples)
folder to see the handlebar packages in action.

**N.b.: Developer docs are coming soon.**

## Roadmap

Immediate updates:
- [ ] Other agent frameworks + python frameworks
- [X] JSON-to-rule conversion
- [X] Audit logs
- [ ] Agent escalations (e.g. human-in-the-loop)

Handlebar is in early development. We have a lot of functionality planned,
but need your feedback on what you need to help you build better agents.

- Refer to the [roadmap](./ROADMAP.md) to see what we're cooking.
- Please feel free to [open an issue](https://github.com/gethandlebar/handlebar-js/issues/new) if you have any feedback or suggestions
- or [join our Discord][discord_invite] to talk to us directly

## Contributing

We welcome contributions from the community: bug reports, feedback, feature requests
Please refer to [CONTRIBUTING.md](./CONTRIBUTING.md)
for ways you can help,
and guidelines.

## Examples

Examples of applying Handlebar to agents can be found in [`./examples/`](./examples/).
If you want to run one locally:

1. Clone the repo
1. Install deps with `bun i` (or `npm i`)
1. Create a `.env` file in the repo root
1. Add your own openai api key as `OPENAI_API_KEY=<your key>`
1. Run the example you want, e.g. `bun run examples/<path-to-example-script>`

More comprehensive examples coming soon.

## License

These SDKs defined under [`packages/`](./packages/)
are currently licensed under the Apache License 2.0.
You’re free to use and distribute it in accordance with that license.

[handlebar]: https://www.gethandlebar.com
[discord_invite]: https://discord.gg/Q6xwvccg
