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

Firstly,
this example has a block rule on fetching PII data/tools
unless the user is an admin.
By default, running the script should see the agent blocked from accessing PII and unable to continue.
To allow execution, run the script with the flag `--admin`, which sets the user's role to "admin",
therefore not being blocked by the Handlebar rule we set.

Secondly,
we don't really want to blindly refund without getting human approval.
Running with the flag `--approval` will add a _sequence_ check,
in particular that the "refund" tool cannot be invoked before the "humanApproval" tool.
With this enacted, the agent is blocked from rushing straight refund,
which redirects it instead to requesting human approval and updating the user's ticket status.
