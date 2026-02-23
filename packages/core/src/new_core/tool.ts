import type { Tool } from "./types";

// Metadata overlay applied when wrapping a tool.
export type ToolMeta = {
	tags?: string[];
	description?: string;
};

// Wrap a tool with additional Handlebar metadata (tags, description) without
// altering its callable interface. Framework-agnostic — works with any tool shape
// that satisfies { name: string }.
//
// Example:
//   const search = wrapTool({ name: "search", execute: ... }, { tags: ["read-only"] });
//   const d = await run.beforeTool(search.name, args, search.tags);
export function wrapTool<T extends Tool>(
	tool: T,
	meta: ToolMeta,
): T & Required<ToolMeta> {
	return {
		...tool,
		tags: meta.tags ?? tool.tags ?? [],
		description: meta.description ?? tool.description ?? "",
	};
}

// Build a tool descriptor inline. Useful when defining tools without a framework wrapper.
//
// Example:
//   const readFile = defineTool("read_file", {
//     description: "Read a file from disk",
//     tags: ["filesystem", "read-only"],
//   });
export function defineTool<Name extends string>(
	name: Name,
	meta?: ToolMeta,
): Tool<Name> & Required<ToolMeta> {
	return {
		name,
		tags: meta?.tags ?? [],
		description: meta?.description ?? "",
	};
}
