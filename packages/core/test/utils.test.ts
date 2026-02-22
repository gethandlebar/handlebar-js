import { describe, expect, it } from "bun:test";
import { generateSlug, getByDotPath, stableJson } from "../src/utils";

describe("generateSlug", () => {
	it("Should generate a consistent 4-part slug", () => {
		const slug = generateSlug();
		expect(slug.split("-")).toHaveLength(4);

		const slug2 = generateSlug();
		expect(slug2).toEqual(slug);
	});
});

// ---------------------------------------------------------------------------
// stableJson
// ---------------------------------------------------------------------------

describe("stableJson", () => {
	it("sorts object keys alphabetically", () => {
		const a = stableJson({ z: 1, a: 2, m: 3 });
		const b = stableJson({ m: 3, z: 1, a: 2 });
		expect(a).toBe(b);
		expect(a).toBe('{"a":2,"m":3,"z":1}');
	});

	it("sorts nested object keys recursively", () => {
		const result = stableJson({ outer: { z: 1, a: 2 } });
		expect(result).toBe('{"outer":{"a":2,"z":1}}');
	});

	it("preserves array order (arrays are not sorted)", () => {
		expect(stableJson([3, 1, 2])).toBe("[3,1,2]");
	});

	it("marks circular references as [Circular]", () => {
		const obj: any = { a: 1 };
		obj.self = obj;
		const result = stableJson(obj);
		expect(result).toContain('"[Circular]"');
	});

	it("handles primitives", () => {
		expect(stableJson(42)).toBe("42");
		expect(stableJson("hello")).toBe('"hello"');
		expect(stableJson(null)).toBe("null");
		expect(stableJson(true)).toBe("true");
	});
});

// ---------------------------------------------------------------------------
// getByDotPath
// ---------------------------------------------------------------------------

describe("getByDotPath", () => {
	it("shallow key", () => {
		expect(getByDotPath({ a: 1 }, "a")).toBe(1);
	});

	it("nested path", () => {
		expect(getByDotPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
	});

	it("missing key → undefined", () => {
		expect(getByDotPath({ a: 1 }, "b")).toBeUndefined();
	});

	it("missing nested key → undefined", () => {
		expect(getByDotPath({ a: {} }, "a.b.c")).toBeUndefined();
	});

	it("null intermediate → undefined", () => {
		expect(getByDotPath({ a: null }, "a.b")).toBeUndefined();
	});

	it("non-object root (string) → undefined", () => {
		expect(getByDotPath("hello", "length")).toBe(5); // strings have .length
	});

	it("empty path returns the whole object", () => {
		const obj = { x: 1 };
		expect(getByDotPath(obj, "")).toBe(obj);
	});
});
