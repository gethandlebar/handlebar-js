import type { ToolResultEventSchema } from "@handlebar/governance-schema";
import type { z } from "zod";
import { approxBytes } from "./metrics";
import { tokeniseCount } from "./tokens";

export function toolResultMetadata(result: unknown): NonNullable<z.infer<typeof ToolResultEventSchema>["data"]["debug"]> {
  const bytes = approxBytes(result);
  let chars: number | undefined;
  let tokens: number | undefined;

  try {
    const json = JSON.stringify(result);
    chars = json.length;
    tokens = tokeniseCount(json);
  } catch { }

  return {
    bytes,
    chars,
    approxTokens: tokens,
  }
}
