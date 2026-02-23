import { describe, expect, it } from "bun:test";
import {
	approxBytes,
	approxRecords,
	validateMetricKey,
} from "../src/metrics/utils";

// ---------------------------------------------------------------------------
// approxBytes
// ---------------------------------------------------------------------------

describe("approxBytes", () => {
	it("null → 0", () => expect(approxBytes(null)).toBe(0));
	it("undefined → 0", () => expect(approxBytes(undefined)).toBe(0));

	it("Buffer → byteLength", () => {
		const buf = Buffer.from("hello");
		expect(approxBytes(buf)).toBe(5);
	});

	it("string → UTF-8 byte count", () => {
		expect(approxBytes("hello")).toBe(5);
		// multi-byte UTF-8 character (3 bytes each)
		expect(approxBytes("€€")).toBe(6);
	});

	it("number → byte count of its string representation", () => {
		expect(approxBytes(42)).toBe(Buffer.byteLength("42", "utf8"));
	});

	it("boolean → byte count of its string representation", () => {
		expect(approxBytes(true)).toBe(Buffer.byteLength("true", "utf8"));
	});

	it("object → JSON byte count", () => {
		const obj = { a: 1 };
		expect(approxBytes(obj)).toBe(
			Buffer.byteLength(JSON.stringify(obj), "utf8"),
		);
	});

	it("array → JSON byte count", () => {
		const arr = [1, 2, 3];
		expect(approxBytes(arr)).toBe(
			Buffer.byteLength(JSON.stringify(arr), "utf8"),
		);
	});
});

// ---------------------------------------------------------------------------
// approxRecords
// ---------------------------------------------------------------------------

describe("approxRecords", () => {
	it("null → 0", () => expect(approxRecords(null)).toBe(0));
	it("undefined → 0", () => expect(approxRecords(undefined)).toBe(0));

	it("array → length", () => expect(approxRecords([1, 2, 3])).toBe(3));
	it("empty array → 0", () => expect(approxRecords([])).toBe(0));

	it("object with .records array → its length", () => {
		expect(approxRecords({ records: ["a", "b"] })).toBe(2);
	});

	it("object with .items array → its length", () => {
		expect(approxRecords({ items: [1, 2, 3, 4] })).toBe(4);
	});

	it("object with .count number → that value", () => {
		expect(approxRecords({ count: 99 })).toBe(99);
	});

	it("plain object without known keys → undefined", () => {
		expect(approxRecords({ x: 1 })).toBeUndefined();
	});

	it("primitive string → undefined", () => {
		expect(approxRecords("hello")).toBeUndefined();
	});

	it("number → undefined", () => {
		expect(approxRecords(42)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// validateMetricKey
// ---------------------------------------------------------------------------

describe("validateMetricKey", () => {
	it("alphanumeric and underscores pass", () => {
		expect(validateMetricKey("valid_key")).toBe(true);
		expect(validateMetricKey("a")).toBe(true);
		expect(validateMetricKey("KEY_123")).toBe(true);
	});

	it("exactly 64 chars passes", () => {
		expect(validateMetricKey("a".repeat(64))).toBe(true);
	});

	it("65 chars fails", () => {
		expect(validateMetricKey("a".repeat(65))).toBe(false);
	});

	it("empty string fails", () => {
		expect(validateMetricKey("")).toBe(false);
	});

	it("hyphen fails", () => {
		expect(validateMetricKey("bad-key")).toBe(false);
	});

	it("dot fails", () => {
		expect(validateMetricKey("bad.key")).toBe(false);
	});

	it("space fails", () => {
		expect(validateMetricKey("bad key")).toBe(false);
	});
});
