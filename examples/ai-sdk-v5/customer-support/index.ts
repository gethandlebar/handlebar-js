import { openai } from "@ai-sdk/openai";
import { HandlebarAgent, type HandlebarCheck } from "@handlebar/ai-sdk-v5";
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

dotenv.config();

// const rules: Rule[] = [
// 	new RuleBuilder("allow-pii-read-for-admin-dpo")
// 		.when(Pred.and(Pred.toolInCategory("pii"), Pred.userIn(["admin", "dpo"])))
// 		.allow("PII read permitted to admin/dpo")
// 		.build(),

// 	// Fallback: if pii.read and not matched above, block
// 	new RuleBuilder("block-pii-read-otherwise")
// 		.when(Pred.and(Pred.toolInCategory("pii")))
// 		.block("PII read forbidden for this user")
// 		.build(),
// ];

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
	governance: {
		userCategory,
		categories: toolCategories,
		// sequence: {
		// 	mustOccurBefore: paymentSequence
		// 		? [
		// 				{
		// 					before: "humanApproval",
		// 					after: "issueRefund",
		// 				},
		// 			]
		// 		: [],
		// 	maxCalls: {
		// 		issueRefund: 1,
		// 		getUserProfile: 1,
		// 	},
		// },
		// rules,
		// checks: [refundValue],
	},
});

const result = await agent.generate({
	prompt: "Solve alice's issue.",
});

console.log(result.text);
console.log(
	"Steps: " +
		result.steps
			.map((step) => step.toolCalls.map((tool) => tool.toolName).join(", "))
			.join("\n"),
);

const govLog = agent.governance.governanceLog
	.map((l) => {
    const ruleIds = l.decision.matchedRuleIds.join("; ");
		return `${l.tool.tool.name}: ${l.decision.effect} ${ruleIds} ${l.decision.reason}`;
	})
	.join("\n");
console.log(govLog);
