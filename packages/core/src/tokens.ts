import { Tiktoken } from "tiktoken";
import cl100k from "tiktoken/encoders/cl100k_base";
import type { LLMMessage } from "./types";

function tokenise<T>(fn: (tokeniser: Tiktoken) => T) {
	const tokeniser = new Tiktoken(
		cl100k.bpe_ranks,
		cl100k.special_tokens,
		cl100k.pat_str,
	);

	const out = fn(tokeniser);
	tokeniser.free();
	return out;
}

export function tokeniseCount(text: string): number {
	return tokenise((tokeniser) => {
		const tokens = tokeniser.encode(text);
		return tokens.length;
	});
}

export function tokeniseByKind(
	messages: LLMMessage[],
): Partial<Record<LLMMessage["role"], number>> {
	return tokenise((tokeniser) => {
		const counts: Partial<Record<LLMMessage["role"], number>> = {};

		for (const message of messages) {
			if (typeof message.content === "string") {
				const tokens = tokeniser.encode(message.content);
				counts[message.role] = (counts[message.role] ?? 0) + tokens.length;
			}
		}
		return counts;
	});
}
