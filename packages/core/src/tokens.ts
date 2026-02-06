import type { LLMResultEventSchema } from "@handlebar/governance-schema";
import * as cl100k_base from "tiktoken/encoders/cl100k_base.json";
import { Tiktoken } from "tiktoken/lite";
import type { z } from "zod";

type LLMMessageKind = keyof NonNullable<z.infer<typeof LLMResultEventSchema>["data"]["debug"]>["inTokenAttribution"]
export type LLMMessage = { kind: LLMMessageKind, content: string };

const encoding = new Tiktoken(
  cl100k_base.bpe_ranks,
  cl100k_base.special_tokens,
  cl100k_base.pat_str
);

export function tokeniseCount(text: string) {
  const tokens = encoding.encode(text);
  encoding.free();
  return tokens.length;
}

export function tokeniseByKind(messages: LLMMessage[]): Partial<Record<LLMMessageKind, number>> {
  const counts: Partial<Record<LLMMessageKind, number>> = {};

  for (const message of messages) {
    const tokens = encoding.encode(message.content);
    encoding.free();
    counts[message.kind] = (counts[message.kind] ?? 0) + tokens.length;
  }

  return counts;
}
