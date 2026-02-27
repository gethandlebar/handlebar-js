import { Handlebar, HandlebarAgentExecutor, wrapTools } from "@handlebar/langchain";
import * as z from "zod";
import { createAgent, tool } from "langchain";
import dotenv from "dotenv";

dotenv.config();

// Prerequisites
// -------------
// Get a Handlebar api key on the platform: https://app.gethandlebar.com
// Set the environment variable HANDLEBAR_API_KEY=<your_api_key>
//
// This demo also runs an OpenAI model, so you'll need to set OPENAI_API_KEY=<your_openai_key>
//
// Run this from repo root as `bun run examples/quickstarts/langchain.ts`

// Initialise the Handlebar client.
// Only needs to be done once.
const hb = await Handlebar.init({
  agent: {
    slug: "langchain-weather-agent", // Slug is the necessary piece to identify your agent

    // Optional fields
    description: "Demonstration agent for Handlebar+Langchain",
    tags: ["weather", "websearch", "demo"], // Tags allow you to set policies on groups of agents by their capabilities
  },
});

const getWeather = tool(
  ({ city }) => `It's always sunny in ${city}!`,
  {
    name: "get_weather",
    description: "Get the weather for a given city",
    schema: z.object({
      city: z.string(),
    }),
  },
);

// Wrap Handlebar tool hooks to evaluate tool requests against your policies.
// Handlebar will block or modify the tool request if there is a policy violation, based on your configuration.
const wrappedTools = wrapTools([getWeather]);

// Base Langchain agent
const agent = createAgent({
  model: "openai:gpt-5-nano",
  tools: wrappedTools,
});

// Patch the agent with Handlebar governance.
// After this, calling agent.invoke() will automatically start/end a Handlebar run
// and enforce your policies on every tool call.
const hbExecutor = new HandlebarAgentExecutor({
  hb,
  agent,
  model: { name: "gpt-5-nano", provider: "openai" },
});

// Important: invoke the handlebar-wrapped executor, not the initial langchain agent.

const out = await hbExecutor.invoke({
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],

  // Optionally provide additional context to Handlebar when invoking.

}, {
  configurable: {
    // Providing an actor/enduser you to configure and enforce per-user rules.
    actor: {
      // If you provide an actor, the externalId (your id for the enduser) is the only required data.
      externalId: "id-for-your-enduser",

      // optional
      metadata: { "tier": "free", "region": "eu"}, // actor metadata allow you to apply rules to groups of users
    },
  }
});
console.log(out);


// Head over to the Handlebar platform (https://app.gethandlebar.com)
// to see your agent logs.
