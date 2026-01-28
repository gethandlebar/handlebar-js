import { tool } from "ai";
import { z } from "zod";
import { DB } from "./data";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const toolCategories: Record<string, string[]> = {};

export const verifyIdentity = tool({
	description: "Verify the customer identity with an OTP code.",
	inputSchema: z.object({ userId: z.string(), code: z.string() }),
	execute: async ({ userId, code }: any) => {
		await sleep(50);
		if (code === "000000") {
			DB.userVerification.add(userId);
			return { verified: true };
		}
		return { verified: false };
	},
});
toolCategories.verifyIdentity = ["auth", "read"];

export const findUserIds = tool({
	description:
		"Get user IDs from a given user name. Use the ID to execute subsequent tools.",
	inputSchema: z.object({ userName: z.string() }),
	execute: async ({ userName }: any) => {
		await sleep(30);
		return Array.from(DB.users.values())
			.filter((user) => user.name.includes(userName))
			.map((user) => ({ id: user.id, name: user.name }));
	},
});
toolCategories.findUserIds = ["pii", "read", "internal"];

export const getUserProfile = tool({
	description: "Fetch a customer's profile (PII).",
	inputSchema: z.object({ userId: z.string() }),
	execute: async ({ userId }: any) => {
		await sleep(30);
		const user = DB.users.get(userId);
		if (!user) throw new Error("User not found");
		return user;
	},
});
toolCategories.getUserProfile = ["pii", "read", "internal"];

export const listOrders = tool({
	description: "List recent orders for a user.",
	inputSchema: z.object({ userId: z.string() }),
	execute: async ({ userId }: any) => {
		await sleep(30);
		return DB.orders.get(userId) ?? [];
	},
});
toolCategories.listOrders = ["finance", "read", "internal"];

// 5) List tickets (less sensitive)
export const listTickets = tool({
	description: "List recent support tickets for a user.",
	inputSchema: z.object({ userId: z.string() }),
	execute: async ({ userId }: any) => {
		await sleep(30);
		return DB.tickets.get(userId) ?? [];
	},
});
toolCategories.listTickets = ["internal", "read"];

// 6) Update contact details (write sensitive)
export const updateContact = tool({
	description: "Update customer's email or phone.",
	inputSchema: z.object({
		userId: z.string(),
		email: z.string().optional(),
		phone: z.string().optional(),
	}),
	execute: async ({ userId, email, phone }: any) => {
		const user = DB.users.get(userId);
		if (!user) throw new Error("User not found");
		if (email) user.email = email;
		if (phone) user.phone = phone;
		return { ok: true, user };
	},
});
toolCategories.updateContact = ["pii", "write", "internal"];

// 7) Issue refund (financial write)
export const issueRefund = tool({
	description: "Issue a refund for an order id.",
	inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
	execute: async ({ orderId, amount }: any) => {
		await sleep(50);
		console.log(`Refunding ${orderId} for ${amount}`);
		return { ok: true, refunded: amount, orderId };
	},
});
toolCategories.issueRefund = ["finance", "write", "external", "sensitive"];

export const humanApproval = tool({
	description:
		"Request human approval for an action you're taking and are unsure of how to proceed.",
	inputSchema: z.object({ action: z.string(), details: z.string().optional() }),
	execute: async ({ action, details }: any) => {
		await sleep(50);
		console.log(`Requesting human approval for ${action}`);
		return { ok: true, action, details };
	},
});
toolCategories.humanApproval = ["external", "governance"];

export const exportUserData = tool({
	description: "Export user data to an external target (S3, GDrive).",
	inputSchema: z.object({ userId: z.string(), target: z.string() }),
	execute: async ({ userId, target }: any) => {
		await sleep(50);
		console.log(`Exporting ${userId} data to ${target}!`);
		return { ok: true, userId, target };
	},
});
toolCategories.exportUserData = ["pii", "external", "sensitive"];

export const resetPassword = tool({
	description: "Reset the customer's password (sends email).",
	inputSchema: z.object({ userId: z.string() }),
	execute: async ({ userId }: any) => {
		await sleep(40);
		return { ok: true, userId };
	},
});
toolCategories.resetPassword = ["write", "sensitive", "external", "auth"];

export const addSupportNote = tool({
	description: "Add an internal note to the customer record.",
	inputSchema: z.object({ userId: z.string(), note: z.string() }),
	execute: async ({ userId, note }: any) => {
		await sleep(20);
		console.log(`Adding note '${note.slice(0, 50)}...' to ${userId}`);
		return { ok: true, userId, noteId: Math.random().toString(36).slice(2) };
	},
});
toolCategories.addSupportNote = ["external", "user"];

export { toolCategories };
