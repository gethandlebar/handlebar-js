import { describe, expect, it } from "bun:test";
import { SubjectRegistry, sanitiseSubjects } from "../src/subjects";

function makeExtractArgs(toolName = "send_email") {
	return {
		tool: {},
		toolName,
		toolArgs: { to: "alice@example.com" },
		run: { runId: "run-1" } as any,
	};
}

// ---------------------------------------------------------------------------
// Registry lifecycle
// ---------------------------------------------------------------------------

describe("SubjectRegistry lifecycle", () => {
	it("register / unregister round-trip", async () => {
		const reg = new SubjectRegistry();
		reg.register("tool_a", async () => [{ subjectType: "user", value: "u1" }]);

		const before = await reg.extract(makeExtractArgs("tool_a"));
		expect(before).toHaveLength(1);

		reg.unregister("tool_a");
		const after = await reg.extract(makeExtractArgs("tool_a"));
		expect(after).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// extract
// ---------------------------------------------------------------------------

describe("SubjectRegistry.extract", () => {
	it("returns subjects from registered extractor", async () => {
		const reg = new SubjectRegistry();
		reg.register("send_email", async ({ toolArgs }) => [
			{ subjectType: "email", value: (toolArgs as any).to },
		]);

		const result = await reg.extract(makeExtractArgs());
		expect(result).toHaveLength(1);
		expect(result[0].value).toBe("alice@example.com");
	});

	it("returns multiple subjects", async () => {
		const reg = new SubjectRegistry();
		reg.register("send_email", async () => [
			{ subjectType: "user", value: "u1" },
			{ subjectType: "user", value: "u2" },
		]);

		const result = await reg.extract(makeExtractArgs());
		expect(result).toHaveLength(2);
	});

	it("no extractor registered → empty array", async () => {
		const reg = new SubjectRegistry();
		const result = await reg.extract(makeExtractArgs("unregistered_tool"));
		expect(result).toEqual([]);
	});

	it("extractor throws → fail closed (empty array, no rethrow)", async () => {
		const reg = new SubjectRegistry();
		reg.register("send_email", async () => {
			throw new Error("extractor crashed");
		});

		const result = await reg.extract(makeExtractArgs());
		expect(result).toEqual([]);
	});

	it("async extractor is awaited", async () => {
		const reg = new SubjectRegistry();
		reg.register("send_email", () =>
			Promise.resolve([{ subjectType: "user", value: "async-u1" }]),
		);

		const result = await reg.extract(makeExtractArgs());
		expect(result[0].value).toBe("async-u1");
	});
});

// ---------------------------------------------------------------------------
// sanitiseSubjects
// ---------------------------------------------------------------------------

describe("sanitiseSubjects", () => {
	it("keeps at most 100 subjects", () => {
		const subjects = Array.from({ length: 150 }, (_, i) => ({
			subjectType: "user",
			value: `u${i}`,
		}));
		expect(sanitiseSubjects(subjects)).toHaveLength(100);
	});

	it("truncates subjectType and value to 256 chars", () => {
		const subjects = [
			{
				subjectType: "t".repeat(300),
				value: "v".repeat(300),
				idSystem: "s".repeat(300),
				role: "r".repeat(300),
			},
		];
		const [s] = sanitiseSubjects(subjects);
		expect(s.subjectType.length).toBe(256);
		expect(s.value.length).toBe(256);
		expect(s.idSystem?.length).toBe(256);
		expect(s.role?.length).toBe(256);
	});

	it("optional fields undefined when not set", () => {
		const [s] = sanitiseSubjects([{ subjectType: "user", value: "u1" }]);
		expect(s.idSystem).toBeUndefined();
		expect(s.role).toBeUndefined();
	});
});
