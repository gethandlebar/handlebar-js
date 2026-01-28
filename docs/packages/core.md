# Handlebar Core

- **Handlebar package:** `@handlebar/core`
- **Framework compatibility:** Agnostic

`core` provides the underlying logic for Handlebar:
- Runtime rule evaluation engine (exported from package as `GovernanceEngine`)
- Communicates with the Handlebar API (e.g. fetch rules, update agent identity)
- Emits audit event logs to Handlebar API

## GovernanceEngine

Each specific agent framework implementation uses `GovernanceEngine` under the hood to evaluate rules;
in these cases, the user typically does not need to interact with `core` directly.

The important constructor params for the engine are:
- `tools`: array of metadata for tools the agent has access to (see `Tool` below)

## Telemetry sinks and emit

```js
import { emit } from "@handlebar/core";
````

The `emit` function sends audit events to any configured sinks.
This function is invoked internally within `GovernanceEngine` and by agent framework SDKs
to emit Handlebar audit events to configured sinks.
The `core` package initialises a `Telemetry` singleton
Refer to [`./governance-schema`](./governance-schema.md) for information on audit events.
