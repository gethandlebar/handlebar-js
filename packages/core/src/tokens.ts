import type { LLMResultEventSchema } from "@handlebar/governance-schema";
import { Tiktoken } from "tiktoken";
import cl100k from "tiktoken/encoders/cl100k_base";
import type { z } from "zod";

type LLMMessageKind = keyof NonNullable<z.infer<typeof LLMResultEventSchema>["data"]["debug"]>["inTokenAttribution"]
export type LLMMessage = { kind: LLMMessageKind, content: string };

function tokenise<T>(fn: (tokeniser: Tiktoken) => T) {
  const tokeniser = new Tiktoken(
    cl100k.bpe_ranks,
    cl100k.special_tokens,
    cl100k.pat_str
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

export function tokeniseByKind(messages: LLMMessage[]): Partial<Record<LLMMessageKind, number>> {
  return tokenise(tokeniser => {
    const counts: Partial<Record<LLMMessageKind, number>> = {};

    for (const message of messages) {
      const tokens = tokeniser.encode(message.content);
      counts[message.kind] = (counts[message.kind] ?? 0) + tokens.length;
    }
    return counts;
  });
}
