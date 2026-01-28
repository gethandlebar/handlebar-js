import { describe, it, expect } from "bun:test";
import { generateSlug } from "../src/utils";

describe("generateSlug", () => {
	it("Should generate a consistent 4-part slug", () => {
		const slug = generateSlug();
		expect(slug.split("-")).toHaveLength(4);

		const slug2 = generateSlug();
		expect(slug2).toEqual(slug);
	});
});
