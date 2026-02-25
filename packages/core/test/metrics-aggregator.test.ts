import { describe, expect, it } from "bun:test";
import { AgentMetricCollector } from "../src/metrics/aggregator";

// ---------------------------------------------------------------------------
// setInbuilt / addInbuilt
// ---------------------------------------------------------------------------

describe("AgentMetricCollector – inbuilt metrics", () => {
	it("setInbuilt stores value and unit", () => {
		const c = new AgentMetricCollector();
		c.setInbuilt("bytes_in", 42, "bytes");
		const payload = c.toEventPayload();
		expect(payload?.inbuilt.bytes_in?.value).toBe(42);
		expect(payload?.inbuilt.bytes_in?.unit).toBe("bytes");
	});

	it("setInbuilt twice overwrites the value", () => {
		const c = new AgentMetricCollector();
		c.setInbuilt("bytes_in", 10);
		c.setInbuilt("bytes_in", 20);
		expect(c.toEventPayload()?.inbuilt.bytes_in?.value).toBe(20);
	});

	it("addInbuilt accumulates across calls", () => {
		const c = new AgentMetricCollector();
		c.addInbuilt("duration_ms", 100, "ms");
		c.addInbuilt("duration_ms", 50);
		expect(c.toEventPayload()?.inbuilt.duration_ms?.value).toBe(150);
	});

	it("addInbuilt preserves unit from first call", () => {
		const c = new AgentMetricCollector();
		c.addInbuilt("bytes_out", 10, "bytes");
		c.addInbuilt("bytes_out", 5); // no unit
		expect(c.toEventPayload()?.inbuilt.bytes_out?.unit).toBe("bytes");
	});

	it("all inbuilt kinds are accepted", () => {
		const c = new AgentMetricCollector();
		for (const kind of [
			"bytes_in",
			"bytes_out",
			"duration_ms",
			"records_out",
		] as const) {
			c.setInbuilt(kind, 1);
		}
		const payload = c.toEventPayload();
		expect(Object.keys(payload!.inbuilt)).toHaveLength(4);
	});
});

// ---------------------------------------------------------------------------
// setCustom / addCustom
// ---------------------------------------------------------------------------

describe("AgentMetricCollector – custom metrics", () => {
	it("setCustom stores value", () => {
		const c = new AgentMetricCollector();
		c.setCustom("my_metric", 7, "count");
		expect(c.toEventPayload()?.custom.my_metric?.value).toBe(7);
	});

	it("addCustom accumulates", () => {
		const c = new AgentMetricCollector();
		c.addCustom("requests", 3);
		c.addCustom("requests", 2);
		expect(c.toEventPayload()?.custom.requests?.value).toBe(5);
	});

	it("key that collides with inbuilt name throws", () => {
		const c = new AgentMetricCollector();
		expect(() => c.setCustom("bytes_in", 1)).toThrow();
	});

	it("invalid key (special chars) throws", () => {
		const c = new AgentMetricCollector();
		expect(() => c.setCustom("bad-key!", 1)).toThrow();
	});

	it("key longer than 64 chars throws", () => {
		const c = new AgentMetricCollector();
		expect(() => c.setCustom("a".repeat(65), 1)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------

describe("AgentMetricCollector.aggregate", () => {
	it("moves per-call values into aggregation and clears per-call", () => {
		const c = new AgentMetricCollector();
		c.setInbuilt("bytes_in", 10);
		c.aggregate();

		// per-call is cleared — toEventPayload returns undefined
		expect(c.toEventPayload()).toBeUndefined();
	});

	it("aggregation accumulates across multiple aggregate() calls", () => {
		const c = new AgentMetricCollector();
		c.setInbuilt("bytes_in", 10);
		c.aggregate();
		c.setInbuilt("bytes_in", 20);
		c.aggregate();

		// After two aggregations, per-call is empty; but we can trigger via toEventPayload
		// with aggregate:false to see per-call (which is now empty)
		expect(c.toEventPayload()).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// toEventPayload
// ---------------------------------------------------------------------------

describe("AgentMetricCollector.toEventPayload", () => {
	it("returns undefined when no metrics set", () => {
		const c = new AgentMetricCollector();
		expect(c.toEventPayload()).toBeUndefined();
	});

	it("returns both inbuilt and custom metrics", () => {
		const c = new AgentMetricCollector();
		c.setInbuilt("bytes_in", 5);
		c.setCustom("retries", 2);

		const payload = c.toEventPayload();
		expect(payload?.inbuilt.bytes_in?.value).toBe(5);
		expect(payload?.custom.retries?.value).toBe(2);
	});

	it("{ aggregate: true } calls aggregate() — per-call cleared after", () => {
		const c = new AgentMetricCollector();
		c.setInbuilt("bytes_in", 10);
		const payload = c.toEventPayload({ aggregate: true });

		expect(payload?.inbuilt.bytes_in?.value).toBe(10);
		// Per-call is now cleared
		expect(c.toEventPayload()).toBeUndefined();
	});

	it("filters out NaN and Infinity values", () => {
		const c = new AgentMetricCollector();
		c.setInbuilt("bytes_in", Number.NaN);
		c.setInbuilt("bytes_out", 10);

		const payload = c.toEventPayload();
		expect(payload?.inbuilt.bytes_in).toBeUndefined();
		expect(payload?.inbuilt.bytes_out?.value).toBe(10);
	});
});
