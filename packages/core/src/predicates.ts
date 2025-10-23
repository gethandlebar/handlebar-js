import type { Predicate, ToolCategory, ToolName, UserCategory } from "./types";

export const Pred = {
	userIs: (cat: UserCategory): Predicate => ({
		evaluate: (ctx) => ctx.userCategory === cat,
	}),
	userIn: (cats: UserCategory[]): Predicate => ({
		evaluate: (ctx) => cats.includes(ctx.userCategory),
	}),
	toolIs: (name: ToolName): Predicate => ({
		evaluate: (_ctx, call) => call.tool.name === name,
	}),
	toolInCategory: (cats: ToolCategory[] | ToolCategory): Predicate => {
		const set = new Set(Array.isArray(cats) ? cats : [cats]);
		return {
			evaluate: (_ctx, call) => call.tool.categories.some((c) => set.has(c)),
		};
	},
	counterLTE: (key: string, limit: number): Predicate => ({
		evaluate: (ctx) => (ctx.counters[key] ?? 0) <= limit,
	}),
	not: (p: Predicate): Predicate => ({
		evaluate: async (ctx, call) => !(await p.evaluate(ctx, call)),
	}),
	and: (...ps: Predicate[]): Predicate => ({
		evaluate: async (ctx, call) => {
			for (const p of ps) if (!(await p.evaluate(ctx, call))) return false;
			return true;
		},
	}),
	or: (...ps: Predicate[]): Predicate => ({
		evaluate: async (ctx, call) => {
			for (const p of ps) if (await p.evaluate(ctx, call)) return true;
			return false;
		},
	}),
};

export class RuleBuilder {
	private _id: string;
	private _pred?: Predicate;
	private _effect: "allow" | "block" = "block";
	private _reason?: string;

	constructor(id: string) {
		this._id = id;
	}
	when(p: Predicate) {
		this._pred = p;
		return this;
	}
	allow(reason?: string) {
		this._effect = "allow";
		this._reason = reason;
		return this;
	}
	block(reason?: string) {
		this._effect = "block";
		this._reason = reason;
		return this;
	}
	build() {
		if (!this._pred) throw new Error(`Rule ${this._id} missing predicate`);
		return {
			id: this._id,
			when: this._pred,
			effect: this._effect,
			reason: this._reason,
		};
	}
}
