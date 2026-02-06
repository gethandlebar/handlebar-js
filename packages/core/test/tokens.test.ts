import { describe, expect, it } from "bun:test";
import { tokeniseCount } from "../src/tokens"

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
});
