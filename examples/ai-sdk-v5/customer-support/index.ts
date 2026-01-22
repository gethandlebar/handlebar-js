import { openai } from "@ai-sdk/openai";
import { HandlebarAgent } from "@handlebar/ai-sdk-v5";
import {
	and,
	block,
	configToRule,
	maxCalls,
	rule,
	sequence,
  toolName,
  type AgentMetricHook,
} from "@handlebar/core";
import type { RuleConfig } from "@handlebar/governance-schema";
import { stepCountIs } from "ai";
import dotenv from "dotenv";
import minimist from "minimist";
import {
	addSupportNote,
	exportUserData,
	findUserIds,
	getUserProfile,
	humanApproval,
	issueRefund,
	listOrders,
	listTickets,
	resetPassword,
	toolCategories,
	updateContact,
	verifyIdentity,
} from "./tools";
import z from "zod";

dotenv.config();

const rules: RuleConfig[] = [
	// rule.pre({
	//   priority: 0,
	//   if: and(toolTag.anyOf(["pii"])),
	//   then: [block()],
	// }),

	// rule.pre({
	//   priority: 1,
	//   if: maxCalls({ selector: { by: "toolTag", tags: ["pii"] }, max: 1 }),
	//   then: [block()],
	// }),

	// Block issueRefund requests after the first one.
	rule.pre({
		priority: 2,
		if: maxCalls({
			selector: { by: "toolName", patterns: ["issueRefund"] },
			max: 1,
		}),
		do: [block()],
	}),

	// Only allow issueRefund if humanApproval has been sought.
	rule.pre({
		priority: 10,
		if: and(
			toolName.eq("issueRefund"),
			sequence({ mustHaveCalled: ["humanApproval"] }),
		),
		do: [block()],
	}),
];

const system = `
You are a support assistant solving user issues.
You will be given a brief request from our internal customer support team. You must, to the best of your ability, use the tools available to you to autonomously resolve the issue, to the extent which is possible.
Plan tool use, then produce a final answer for the user.`.trim();

const args = minimist(process.argv.slice(2));
const userCategory = args["admin"] ? "admin" : "randomuser";
const paymentSequence = args["approval"];

console.log(
	`User category: ${userCategory}; Enforcing human approval: ${paymentSequence ? "enabled" : "disabled"}`,
);

const tools = {
	findUserIds,
	getUserProfile,
	listOrders,
	verifyIdentity,
	listTickets,
	resetPassword,
	addSupportNote,
	issueRefund,
	humanApproval,
	updateContact,
	exportUserData,
};

// const refundValue: HandlebarCheck<typeof tools> = {
// 	id: "max-refund-10",
// 	before: (ctx, toolCall): Decision | undefined => {
// 		if (toolCall.tool.name === "issueRefund") {
// 			// @ts-expect-error - TODO: fix args type inference.
// 			if (toolCall.args.amount > 10) {
// 				return {
// 					effect: "block",
// 					code: "BLOCKED_CUSTOM",
// 					reason: "Refund amount exceeds the maximum of 10",
// 				};
// 			}
// 		}
// 		return undefined;
// 	},
// };

const model = openai("gpt-5-nano");
const agent = new HandlebarAgent({
	system,
	model,
	tools,
	stopWhen: stepCountIs(10),
	agent: {
		slug: "customer-support",
	},
	governance: {
		userCategory,
		categories: toolCategories,
		rules: [], // rules.map(configToRule), // Adds IDs to rules to match expected schema.
	},
});

// --- Custom metric calculation during runtime ---
// Handlebar calculates your custom metrics as the agent executes tool,
// alongside key inbuilt metrics such as token usage and total bytes in/out of tools.
// These metrics are sent to the API, and can be used in rule evaluations.
// For example, "agent cannot transfer more than 1GB of PII per user per day" is a valid rule you can configure!

const beforeToolUsageMetric: AgentMetricHook = {
  phase: "tool.before", // Evaluated just on tool inputs data
  key: "some_random_metric",
  run(ctx) {
    return {
      value: 10,
      unit: "$"
    }
  },
}

// Evaluate after if your metric needs to make use of tool results.
const afterToolUsageMetric: AgentMetricHook<"tool.after"> = {
  phase: "tool.after",
  key: "after_tool_metric_1",
  run: async ({ toolName, args, runContext, result }) => { // Can be async
    const ExpectedOutputSchema = z.object({ balanceTransfer: z.number().min(0) });

    // Make use of input args, tool output, or other runtime data.
    const output = ExpectedOutputSchema.safeParse(result ?? {});

    if (!output.success) {
      return;
    }

    return {
      value: output.data.balanceTransfer,
      unit: "£"
    }
  }
}

agent.governance.registerMetric(beforeToolUsageMetric);
agent.governance.registerMetric(afterToolUsageMetric);

// --- Custom metrics end ---


const result = await agent.generate(
	[
		{
			prompt: "Solve alice's issue.",
		},
	],
	{
		enduser: {
			externalId: "an-external-user", // The user's ID in your system, so you can identify their agent usage.
			metadata: { role: "user" }, // Optional
			// Group information is optional.
			// If provided, Handlebar will link the provided user to the group.
			group: {
				externalId: "org1",
				name: "Your customer org",
				metadata: { region: "eu", plan: "premium" },
			},
		},
	},
);

console.log(result.text);
console.log(
	"Steps: " +
		result.steps
			.map((step) => step.toolCalls.map((tool) => tool.toolName).join(", "))
			.join("\n"),
);
