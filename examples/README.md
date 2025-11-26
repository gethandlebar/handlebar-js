# Examples

Examples of applying Handlebar to agents in different building frameworks.
If you want to run one locally:

1. Clone the repo
1. In the root, install deps with `bun i` (or `npm i`)
1. Create a `.env` file in the repo root
1. Add your own openai api key as `OPENAI_API_KEY=<your key>`
1. Run the example you want (see below)

_More examples coming soon._

## ai-sdk-v5

### customer-support

An agent capable of fetching customer support queries,
updating a user's tickets,
and issuing refunds.
This example demonstrates using Handlebar for:

- PII access control based on the user's role
- Enforcing human approval before risky actions

Run `bun run examples/ai-sdk-v5/customer-support/index.ts` to see it in action.

To view audit logs, connect to the opensource dashboard, [`Lens`][lens],
or get in touch with us at `contact@gethandlebar.com`
to get access to the Handlebar platform (currently in beta).

[lens]: https://github.com/gethandlebar/lens
