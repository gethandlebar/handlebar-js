import { describe, expect, test } from "bun:test";
import { defineTool, wrapTool } from "../../src/new_core/tool";

describe("wrapTool", () => {
	test("adds tags to a plain tool", () => {
		const tool = { name: "search" };
		const wrapped = wrapTool(tool, { tags: ["read-only"] });
		expect(wrapped.name).toBe("search");
		expect(wrapped.tags).toEqual(["read-only"]);
	});

	test("merges description", () => {
		const tool = { name: "search" };
		const wrapped = wrapTool(tool, { description: "Search the web" });
		expect(wrapped.description).toBe("Search the web");
	});

	test("preserves all original tool properties", () => {
		const tool = { name: "search", execute: () => "result", custom: 42 };
		const wrapped = wrapTool(tool, { tags: ["read"] });
		expect(wrapped.execute).toBeDefined();
		expect(wrapped.custom).toBe(42);
	});

	test("meta tags override existing tool tags", () => {
		const tool = { name: "search", tags: ["old-tag"] };
		const wrapped = wrapTool(tool, { tags: ["new-tag"] });
		expect(wrapped.tags).toEqual(["new-tag"]);
	});

	test("falls back to existing tool tags when meta provides none", () => {
		const tool = { name: "search", tags: ["existing"] };
		const wrapped = wrapTool(tool, {});
		expect(wrapped.tags).toEqual(["existing"]);
	});

	test("TypeScript: wrapped type retains original shape", () => {
		const tool = { name: "write_file" as const, execute: (_path: string) => true };
		const wrapped = wrapTool(tool, { tags: ["write"] });
		// Type check: wrapped.execute should be callable.
		expect(wrapped.execute("/tmp/x")).toBe(true);
	});
});

describe("defineTool", () => {
	test("creates a tool with name and tags", () => {
		const t = defineTool("read_file", { tags: ["filesystem", "read-only"] });
		expect(t.name).toBe("read_file");
		expect(t.tags).toEqual(["filesystem", "read-only"]);
	});

	test("defaults to empty tags and description when meta omitted", () => {
		const t = defineTool("noop");
		expect(t.tags).toEqual([]);
		expect(t.description).toBe("");
	});

	test("name is preserved as literal type", () => {
		const t = defineTool("my_tool" as const);
		// TypeScript: t.name should be "my_tool" literal, checked at runtime.
		expect(t.name).toBe("my_tool");
	});
});
