import dotenv from "dotenv";
dotenv.config();

const file = Bun.file("examples/ai-sdk-v5/customer-support/handlebar-rules.json");

const text = await file.text();

const apiEndpoint = `${process.env.HANDLEBAR_API_ENDPOINT}/v1/rules/`
await fetch(apiEndpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.HANDLEBAR_API_KEY}`
  },
  body: text,
});
