import { describe, expect, it } from "bun:test";
import { toolResultMetadata } from "../src/tool";

describe("toolResultMetadata", () => {
	it("should treat null input as strings", () => {
		expect(toolResultMetadata(null)).toEqual({
			approxTokens: 1,
			bytes: 0,
			chars: 4,
		});
	});

	it("should return undefined values for undefined", () => {
		expect(toolResultMetadata(undefined)).toEqual({
			approxTokens: undefined,
			bytes: 0,
			chars: undefined,
		});
	});

	it("should treat bool input as strings", () => {
		expect(toolResultMetadata(true)).toEqual({
			approxTokens: 1,
			bytes: 4,
			chars: 4,
		});

		expect(toolResultMetadata(false)).toEqual({
			approxTokens: 1,
			bytes: 5,
			chars: 5,
		});
	});

	it("should calculate for string", () => {
		const data =
			"this is a string with some number of tokens SolidGoldMagikarp";
		const output = toolResultMetadata(data);

		expect(output.approxTokens).not.toBeUndefined();
		expect(output.approxTokens).toEqual(16);

		expect(output.bytes).not.toBeUndefined();
		expect(output.bytes).toEqual(61);

		expect(output.chars).not.toBeUndefined();
		expect(output.chars).toEqual(63);
	});

	it("should stringify objects", () => {
		const data = {
			someValue: { nested: 1 },
			another: "a string with some number of tokens",
		};

		const output = toolResultMetadata(data);
		expect(output.approxTokens).not.toBeUndefined();
		expect(output.approxTokens).toEqual(18);

		expect(output.bytes).not.toBeUndefined();
		expect(output.bytes).toEqual(74);

		expect(output.chars).not.toBeUndefined();
		expect(output.chars).toEqual(74);
	});
});
