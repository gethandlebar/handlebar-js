import { openai } from "@ai-sdk/openai";
import { HandlebarAgent } from "@handlebar/ai-sdk-v5";
import {
  type AgentMetricHook,
} from "@handlebar/core";
import { stepCountIs } from "ai";
import dotenv from "dotenv";
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

// const rules: RuleConfig[] = [
// 	// rule.pre({
// 	//   priority: 0,
// 	//   if: and(toolTag.anyOf(["pii"])),
// 	//   then: [block()],
// 	// }),

// 	// rule.pre({
// 	//   priority: 1,
// 	//   if: maxCalls({ selector: { by: "toolTag", tags: ["pii"] }, max: 1 }),
// 	//   then: [block()],
// 	// }),

// 	// Block issueRefund requests after the first one.
// 	rule.pre({
// 		priority: 2,
// 		if: maxCalls({
// 			selector: { by: "toolName", patterns: ["issueRefund"] },
// 			max: 1,
// 		}),
// 		do: [block()],
// 	}),

// 	// Only allow issueRefund if humanApproval has been sought.
// 	rule.pre({
// 		priority: 10,
// 		if: and(
// 			toolName.eq("issueRefund"),
// 			sequence({ mustHaveCalled: ["humanApproval"] }),
// 		),
// 		do: [block()],
// 	}),
// ];

const system = `
You are a support assistant solving user issues.
You will be given a brief request from our internal customer support team. You must, to the best of your ability, use the tools available to you to autonomously resolve the issue, to the extent which is possible.
Plan tool use, then produce a final answer for the user.`.trim();

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
    categories: toolCategories,
		// rules are queried from the Handlebar API at init.
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
  run: async ({ toolName, runContext, result }) => { // Can be async
    if (toolName !== "issueRefund") {
      return;
    }

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

// --- Subjects and signals ---

// We've set a rule for "difficult customers" to always have a human-in-the-loop
// See `handlebar-rules.json` for the rule
// Like all signals, "difficult customers" is internal logic that's meaningful to your system,
// so you define how Handlebar makes use of this information.
// From the rule we've defined, we need:
//    (a) A subject representing the customer
//      (i) this can be extracted from tool args
//      (ii) this typically might involve a DB or cache read to enrich with internal information you hold about the user
//      (iii) Subjects don't need to reference people - a subject is a formalisation of any data you want to pass through to Handlebar rules
//    (b) A signal which defines our "is difficult" attribute, based on the customer in question

// We'll attach a subject to our "getUserProfile" as this is the earliest point
// where our agent could realise it's coming up against a customer we'd rather handle manually.
agent.governance.registerSubjectExtractor("getUserProfile", (args) => {
  console.log(`Subject getUserProfile: ${JSON.stringify(args)}`);
  const UserProfileSchema = z.object({ userId: z.string() });
  try {
    const toolResult = UserProfileSchema.safeParse(args.toolArgs);
    if (!toolResult.success) {
      console.log(`getUserProfile: invalid args: ${JSON.stringify(toolResult.error)}`);
      return [];
    }
    return [{
      subjectType: "customer",
      role: "primary",
      value: toolResult.data.userId,
      idSystem: "crm_customer_id"
    }];
  } catch (e) {
    console.error(`getUserProfile: unexpected error: ${JSON.stringify(e)}`);
    return [];
  }
});

agent.governance.registerSignal("crm.isCustomerDifficult", async (args) => {
  // TODO: we need better typing on signals and subjects!
  console.log(`crm.isCustomerDifficult: ${JSON.stringify(args)}`);
  const expectArgs = args as { customerId: string };

  // here we'd want a DB/CRM/other query to determine our difficulty metric.
  // For this demo, however, we'll mock
  // "u_123" represents "alice" in our mock data (./data.ts)
  const result = expectArgs.customerId === "u_123";
  console.log(`crm.isCustomerDifficult: ${result}`);
  return result;
});

// --- Subjects and signals end ---

const runtimeUser = {
  enduser: {
    externalId: "an-enduser-id", // The user's ID in your system, so you can identify their agent usage.
    metadata: { role: "user" }, // Optional
    // Group information is optional.
    // If provided, Handlebar will link the provided user to the group.
    group: {
      externalId: "endusers-org",
      name: "Your customer org",
      metadata: { region: "eu", plan: "premium" },
    },
  },
}

// OPTIONAL: pass in runtime enduser information in `with`.
// Otherwise, you execute the agent as you would normally on Vercel's Agent class.
const result = await agent.with(runtimeUser).generate({ prompt: "Solve alice's issue." });

console.log(result.text);
console.log(
	"Steps: " +
		result.steps
			.map((step) => step.toolCalls.map((tool) => tool.toolName).join(", "))
			.join("\n"),
);
