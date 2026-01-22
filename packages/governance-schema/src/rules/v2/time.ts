export type TimeGateCondition = {
	kind: "timeGate";
	timezone: // | { source: "org" }
	{ source: "endUserTag"; tag: string; fallback?: "org" };
	// TODO: specify a timezone in condition.
	windows: Array<{
		days: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
		start: string;
		end: string;
	}>;
};
