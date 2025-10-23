export const DB = {
	users: new Map<string, any>([
		[
			"u_123",
			{
				id: "u_123",
				email: "alice@example.com",
				phone: "+12025550123",
				name: "Alice",
				region: "EU",
				subscription: "pro",
			},
		],
		[
			"u_456",
			{
				id: "u_456",
				email: "bob@example.com",
				phone: "+12025550124",
				name: "Bob",
				region: "US",
				subscription: "free",
			},
		],
	]),
	orders: new Map<string, any[]>([
		["u_123", [{ id: "o_1", amount: 4900, currency: "USD", status: "paid" }]],
		["u_456", [{ id: "o_2", amount: 990, currency: "USD", status: "paid" }]],
	]),
	tickets: new Map<string, any[]>([
		[
			"u_123",
			[
				{
					id: "t_77",
					subject: "You need to refund my last order! It arrived broken",
					status: "open",
				},
			],
		],
	]),
	sessions: new Set<string>(), // agent session flags
	userVerification: new Set<string>(), // verified users for this run
};
