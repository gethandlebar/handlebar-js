Create unit tests for the main elements of `@handlebar/core` package (packages/core). Use the "bun:test" library and write tests in `packages/core/test/`. Mock interactions the code has with APIs. In the tests, capture a couple happy paths and a few failure cases:
- unexpected but possible inputs
- the code throws an error when expected
- the code returns nulls/undefined when expected

The objective in this testing is to capture the capabilities of `core` for regressions as it later undergoes a large refactor. In particular, we want to test:
- how the shared run context is updated and accessed
- how rule evaluations are handled at each stage of the lifecycle
- that lifecycle emits events as expected
- calculation of inbuilt metrics like token usage
- telemetry and sinks work as expected (primarily HTTP - console and file do not need to be tested)
- metric collection and resetting work as expected (packages/core/metrics/)
- Budgets are requested and evaluated (packages/core/budget-manager.ts)
- 

If you think you have identified a bug in logic while constructing the tests, make a note of it in this file and report it to the user; do NOT make a test for either the actual or expected behavior in this scenario.

## Plan
<edit the plan>
