import { z } from "zod";
import { RuleSpecSchema, PolicySpecSchema } from "@handlebar/governance-schema";
import dotenv from "dotenv";
dotenv.config();

const file = Bun.file("examples/ai-sdk-v5/customer-support/handlebar-rules.json");

const text = await file.text();

const BodySchema = z.object({
  rules: z.array(RuleSpecSchema),
  policy: PolicySpecSchema,
});
const fileJson = JSON.parse(text);
const body = BodySchema.parse(fileJson);

const apiEndpoint = `${process.env.HANDLEBAR_API_ENDPOINT}/v1/rules/`
await fetch(apiEndpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.HANDLEBAR_API_KEY}`
  },
  body: JSON.stringify(body),
});
