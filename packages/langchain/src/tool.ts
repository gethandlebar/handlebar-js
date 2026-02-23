import { getCurrentRun } from "@handlebar/core";
import type { StructuredToolInterface } from "@langchain/core/tools";

/**
 * Thrown when a BLOCK + TERMINATE governance decision occurs during a tool call.
 * HandlebarAgentExecutor catches this and ends the run with "interrupted" status.
 */
export class HandlebarTerminationError extends Error {
	constructor(message?: string) {
		super(message ?? "Handlebar governance terminated the run");
		this.name = "HandlebarTerminationError";
	}
}

/**
 * Wraps a single LangChain tool with Handlebar beforeTool / afterTool governance hooks.
 * Mutates the tool instance in place.
 *
 * - ALLOW            → executes the tool normally.
 * - BLOCK + CONTINUE → returns a blocked-message string for the LLM; execution is skipped.
 * - BLOCK + TERMINATE→ throws HandlebarTerminationError, caught by HandlebarAgentExecutor.
 */
export function wrapTool<T extends StructuredToolInterface>(
	tool: T,
	toolTags: string[] = [],
): T {
	const originalInvoke = tool.invoke.bind(tool);

	// biome-ignore lint/suspicious/noExplicitAny: overwriting invoke on the instance
	(tool as any).invoke = async (
		input: Parameters<T["invoke"]>[0],
		options?: Parameters<T["invoke"]>[1],
	): Promise<string> => {
		const run = getCurrentRun();
		if (!run) return originalInvoke(input, options);

		const decision = await run.beforeTool(tool.name, input, toolTags);

		if (decision.verdict === "BLOCK") {
			if (decision.control === "TERMINATE") {
				throw new HandlebarTerminationError(decision.message);
			}
			return JSON.stringify({
				blocked: true,
				agentNextStep:
					"The tool call has been blocked by Handlebar governance. Do not reference Handlebar or rule violations in further commentary.",
				reason: decision.message,
			});
		}

		const start = Date.now();
		try {
			const result = await originalInvoke(input, options);
			await run.afterTool(tool.name, input, result, Date.now() - start, undefined, toolTags);
			return result;
		} catch (err) {
			await run.afterTool(tool.name, input, undefined, Date.now() - start, err, toolTags);
			throw err;
		}
	};

	return tool;
}

/**
 * Wraps an array of LangChain tools with Handlebar governance hooks.
 * Returns the same array (tools are mutated in place).
 *
 * Call this before passing tools to AgentExecutor.fromAgentAndTools().
 *
 * @example
 * const tools = wrapTools([new SearchTool(), new CodeTool()], {
 *   toolTags: { search: ["read-only"], code_executor: ["execution"] },
 * });
 * const executor = AgentExecutor.fromAgentAndTools({ agent, tools });
 */
export function wrapTools<T extends StructuredToolInterface>(
	tools: T[],
	opts: { toolTags?: Record<string, string[]> } = {},
): T[] {
	for (const tool of tools) {
		wrapTool(tool, opts.toolTags?.[tool.name] ?? []);
	}
	return tools;
}
