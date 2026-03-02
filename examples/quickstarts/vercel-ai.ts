import { tool, Handlebar, HandlebarAgent } from "@handlebar/ai-sdk"
import z from "zod";

const handlebar = await Handlebar.init({
  agent: { slug: "vercel-ai-v6-demo" }
});

const randomNumber = tool({
  title: "Generate random number",
  inputSchema: z.object({
    min: z.number(),
    max: z.number(),
  }),
  execute: async (args) => {
    const { min, max } = args;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
  tags: ["simple"],
});

const agent = new HandlebarAgent({
  model: "openai/gpt-5-nano",
  tools: {
    randomNumber,
  },
  hb: handlebar,
});

await agent.generate({
  // Normal vercel ai params
  prompt: "Give us a number between -10 and 1billion",

  // optional handlebar params
  actor: {
    externalId: "your-users-id",
  },
});
