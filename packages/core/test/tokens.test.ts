import { describe, expect, it } from "bun:test";
import { tokeniseByKind, tokeniseCount } from "../src/tokens"

describe("tokeniseCount", () => {
  it("Should have consistent token count", () => {
    const testString = "a test! string! containing _much text__"
    const tokens1 = tokeniseCount(testString);
    const tokens2 = tokeniseCount(testString);
    expect(tokens1).toEqual(tokens2);
  });

  it("Should reset tokens from one string to another", () => {
    const tokens1 = tokeniseCount("a test string!containing_some_tokens");
    const tokens2 = tokeniseCount("a different one");
    expect(tokens1).toBeGreaterThan(tokens2);
  });

  it("Should return 0 for empty string", () => {
    const tokens = tokeniseCount("");
    expect(tokens).toEqual(0);
  });
});

describe("tokeniseByKind", () => {
  it("Should return empty record if no messages", () => {
    const counts = tokeniseByKind([]);
    expect(counts).toEqual({});
  });

  it("Should return only types present in messages", () => {
    const counts = tokeniseByKind([
      { kind: "assistant", content: "Hello world" },
      { kind: "system", content: "world" },
      { kind: "tool", content: "!" }
    ]);
    expect(counts).toEqual({ assistant: 2, system: 1, tool: 1 });
  });

  it("Should add not overwrite tokens from multiple kinds", () => {
    const counts = tokeniseByKind([
      { kind: "assistant", content: "This is several more tokens than 1, so the result should be more than 1" },
      { kind: "assistant", content: "a" }, // a single token.
    ]);
    expect(counts.assistant).not.toBeUndefined();
    expect(counts.assistant).toBeGreaterThan(1);
  })
})
