import { tool as aiTool } from "ai";

export const HANDLEBAR_TAGS = Symbol("handlebar.tags");

// biome-ignore lint/suspicious/noExplicitAny: pass-through generics
type AiToolConfig<P, R> = Parameters<typeof aiTool<P, R>>[0];
// biome-ignore lint/suspicious/noExplicitAny: pass-through generics
type AiToolResult<P, R> = ReturnType<typeof aiTool<P, R>>;

/**
 * Drop-in replacement for `tool` from `ai`. Accepts an optional `tags` array for
 * Handlebar governance rule matching. Tags are picked up automatically by
 * HandlebarAgent — no need to pass `toolTags` separately.
 */
export function tool<PARAMETERS, RESULT>(
	config: AiToolConfig<PARAMETERS, RESULT> & { tags?: string[] },
): AiToolResult<PARAMETERS, RESULT> & { [HANDLEBAR_TAGS]?: string[] } {
	const { tags, ...rest } = config;
	// biome-ignore lint/suspicious/noExplicitAny: narrowing the spread back to the original type
	const t = aiTool(rest as AiToolConfig<PARAMETERS, RESULT>);
	if (tags !== undefined) {
		(t as Record<symbol, unknown>)[HANDLEBAR_TAGS] = tags;
	}
	return t as AiToolResult<PARAMETERS, RESULT> & { [HANDLEBAR_TAGS]?: string[] };
}
