import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { BudgetManager } from "../src/budget-manager";
import type { BudgetGrant } from "../src/api/types";

function makeGrant(overrides: Partial<BudgetGrant> = {}): BudgetGrant {
	return {
		id: "rule-1",
		decision: "allow",
		grant: 100,
		computed: null,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Constructor defaults
// ---------------------------------------------------------------------------

describe("BudgetManager constructor", () => {
	it("starts with empty budgets and reevaluate() returns false (TTL fresh)", () => {
		const bm = new BudgetManager();
		// TTL just set in constructor — reevaluate() returns false immediately
		expect(bm.reevaluate()).toBe(false);
	});

	it("accepts pre-seeded budgets", () => {
		const bm = new BudgetManager({ budgets: [makeGrant()] });
		expect(bm.budgets).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// updateBudgets
// ---------------------------------------------------------------------------

describe("BudgetManager.updateBudgets", () => {
	it("replaces budgets and resets TTL", () => {
		const bm = new BudgetManager();
		bm.updateBudgets(60, [makeGrant({ id: "r1", grant: 50 })]);

		expect(bm.budgets).toHaveLength(1);
		expect(bm.budgets[0].grant).toBe(50);
		// TTL was just reset, so reevaluate() should be false
		expect(bm.reevaluate()).toBe(false);
	});

	it("empty array clears budgets", () => {
		const bm = new BudgetManager({ budgets: [makeGrant()] });
		bm.updateBudgets(60, []);
		expect(bm.budgets).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// usage
// ---------------------------------------------------------------------------

describe("BudgetManager.usage", () => {
	it("decrements grant for matching rule", () => {
		const bm = new BudgetManager({ budgets: [makeGrant({ id: "r1", grant: 100 })] });
		bm.usage({ "r1": 30 });
		expect(bm.budgets[0].grant).toBe(70);
	});

	it("does not affect other grants", () => {
		const bm = new BudgetManager({
			budgets: [
				makeGrant({ id: "r1", grant: 100 }),
				makeGrant({ id: "r2", grant: 50 }),
			],
		});
		bm.usage({ "r1": 10 });
		expect(bm.budgets[1].grant).toBe(50);
	});

	it("no usage entry for rule → grant unchanged", () => {
		const bm = new BudgetManager({ budgets: [makeGrant({ id: "r1", grant: 100 })] });
		bm.usage({ "r2": 10 });
		expect(bm.budgets[0].grant).toBe(100);
	});

	it("null grant is not modified (server-controlled)", () => {
		const bm = new BudgetManager({ budgets: [makeGrant({ id: "r1", grant: null })] });
		bm.usage({ "r1": 50 });
		expect(bm.budgets[0].grant).toBeNull();
	});

	it("grant can go negative", () => {
		const bm = new BudgetManager({ budgets: [makeGrant({ id: "r1", grant: 10 })] });
		bm.usage({ "r1": 50 });
		expect(bm.budgets[0].grant).toBe(-40);
	});
});

// ---------------------------------------------------------------------------
// reevaluate
// ---------------------------------------------------------------------------

describe("BudgetManager.reevaluate", () => {
	let realDateNow: () => number;

	beforeEach(() => {
		realDateNow = Date.now;
	});

	afterEach(() => {
		Date.now = realDateNow;
	});

	it("returns true when TTL has expired", () => {
		let t = 1_000_000;
		Date.now = mock(() => t);

		const bm = new BudgetManager({ globalTtlSeconds: 60 });

		// Advance time past the TTL
		t += 61_000;
		expect(bm.reevaluate()).toBe(true);
	});

	it("returns true immediately when a grant is exhausted (≤ 0)", () => {
		const bm = new BudgetManager({
			budgets: [makeGrant({ id: "r1", grant: 0 })],
		});
		expect(bm.reevaluate()).toBe(true);
	});

	it("returns false when TTL fresh and no grants exhausted", () => {
		const bm = new BudgetManager({
			budgets: [makeGrant({ id: "r1", grant: 50 })],
		});
		expect(bm.reevaluate()).toBe(false);
	});

	it("null grant does not trigger exhaustion check", () => {
		const bm = new BudgetManager({
			budgets: [makeGrant({ id: "r1", grant: null })],
		});
		expect(bm.reevaluate()).toBe(false);
	});

	it("usage to zero then reevaluate returns true", () => {
		const bm = new BudgetManager({ budgets: [makeGrant({ id: "r1", grant: 10 })] });
		bm.usage({ "r1": 10 });
		expect(bm.reevaluate()).toBe(true);
	});

	it("after updateBudgets the TTL resets and reevaluate returns false", () => {
		let t = 1_000_000;
		Date.now = mock(() => t);

		const bm = new BudgetManager({ globalTtlSeconds: 60 });
		t += 61_000; // expire TTL
		expect(bm.reevaluate()).toBe(true); // expired

		// Simulate budget refresh
		bm.updateBudgets(60, [makeGrant()]);
		expect(bm.reevaluate()).toBe(false); // TTL reset by updateBudgets
	});

	it("reevaluate() returning true does not reset TTL — repeated calls still return true until updateBudgets is called", () => {
		let t = 1_000_000;
		Date.now = mock(() => t);

		const bm = new BudgetManager({ globalTtlSeconds: 60 });
		t += 61_000;

		expect(bm.reevaluate()).toBe(true); // TTL expired
		expect(bm.reevaluate()).toBe(true); // still expired — updateBudgets not called
	});
});
