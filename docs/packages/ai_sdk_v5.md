# Vercel AI Handlebar Integration

- **Handlebar package**: `@handlebar/ai-sdk-v5`
- **Framework compatibility**: `ai@^5.0.0`. Might work with `^6.0.0`

Handlebar has first-class support for agents built with Vercel's `ai` framework.
The Handlebar package exports an `HandlebarAgent` class, which is a drop-in replacement for `ai`'s `Experimental_Agent` class. `HandlebarAgent` aims to have parity with `Experimental_Agent` (i.e. no changes to method executions are **required**).

N.b. in `ai@6`, this class is no longer experimental; there might be some breaking changes that stops the `HandlebarAgent` class from working directly.

## Configuration

The Handlebar agent will:
- Load relevant rulesets from the Handlebar API
- Evaluate the rules against the agent's actions client-side
- Emit event audit logs to the Handlebar API

## Drop-in replacement

You can use `HandlebarAgent` as a drop-in replacement without needing to change the constructor or method calls.
With this change, Handlebar is configured on the agent to load and evaluate rules, and emit event logs.
All further configuration is optional.

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

## Agent spec

You can define an identity for the agent, giving Handlebar useful additional context, as well as a human-readable name. N.b. without providing an agent `slug`, Handlebar will generate one based on the agent's PWD.

The agent identity spec is:
```
{
  slug: string;
  name?: string;
  description?: string;
  tags?: string[]; // tags meaningful to the user. Can be used to group agent behaviours on Handlebar.
}
```

```diff
import { HandlebarAgent } from '@handlebar/ai-sdk-v5';

const agent = new HandlebarAgent({
system,
model,
tools,
+ agent: {
+  slug: "customer-support",
+  name: "Custy the Customer Support Agent",
+  tags: ["customer-facing", "payments", "triage", "prod", "eu"],
+ },
});
```

## Enduser identity at runtime

You can optionally provide information about the enduser on whose behalf the agent is acting.
This information can be used to define rules on historic enduser behaviour or the enduser's attributes.
For example, to limit some tools to a subgroup of endusers, or set a sliding-window of resource usage for each enduser.

The enduser identity spec is:
```
{
  enduser?: {
    externalId?: string, // A Handlebar user's ID for _their_ user
	  metadata?: { string: string }, // Arbitrary attributes to attach to the user.
	  name?: string,
		group?: { // A single group to attach endusers to. E.g. an organisation or team.
  		externalId?: string,
  		metadata?: { string: string },
   	  name?: string,
		}
  }
}
```
