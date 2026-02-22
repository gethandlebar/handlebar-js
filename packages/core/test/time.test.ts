import { describe, expect, it } from "bun:test";
import { hhmmToMinutes, nowToTimeParts } from "../src/time";

// ---------------------------------------------------------------------------
// hhmmToMinutes
// ---------------------------------------------------------------------------

describe("hhmmToMinutes", () => {
	it("00:00 → 0", () => expect(hhmmToMinutes("00:00")).toBe(0));
	it("23:59 → 1439", () => expect(hhmmToMinutes("23:59")).toBe(1439));
	it("09:30 → 570", () => expect(hhmmToMinutes("09:30")).toBe(570));
	it("12:00 → 720", () => expect(hhmmToMinutes("12:00")).toBe(720));
	it("01:01 → 61", () => expect(hhmmToMinutes("01:01")).toBe(61));
});

// ---------------------------------------------------------------------------
// nowToTimeParts
// ---------------------------------------------------------------------------

describe("nowToTimeParts", () => {
	// 2024-01-15 is a Monday; 12:00:00 UTC
	const MONDAY_NOON_UTC = new Date("2024-01-15T12:00:00Z").getTime();

	it("returns correct hhmm and dow in UTC", () => {
		const { dow, hhmm } = nowToTimeParts(MONDAY_NOON_UTC, "UTC");
		expect(dow).toBe("mon");
		expect(hhmm).toBe("12:00");
	});

	it("UTC+5:30 (Asia/Kolkata) shifts noon UTC to 17:30", () => {
		const { hhmm, dow } = nowToTimeParts(MONDAY_NOON_UTC, "Asia/Kolkata");
		expect(hhmm).toBe("17:30");
		expect(dow).toBe("mon");
	});

	it("UTC-5 (America/New_York) shifts noon UTC to 07:00 in January (EST)", () => {
		const { hhmm } = nowToTimeParts(MONDAY_NOON_UTC, "America/New_York");
		expect(hhmm).toBe("07:00");
	});

	it("day-of-week rolls over when timezone crosses midnight", () => {
		// 2024-01-15 23:30 UTC = 2024-01-16 00:30 AEDT (UTC+11)
		const lateMonday = new Date("2024-01-15T23:30:00Z").getTime();
		const { dow } = nowToTimeParts(lateMonday, "Australia/Sydney");
		// In Sydney it's already Tuesday
		expect(dow).toBe("tue");
	});

	it("dow is 3-char lowercase", () => {
		const { dow } = nowToTimeParts(MONDAY_NOON_UTC, "UTC");
		expect(dow).toMatch(/^[a-z]{3}$/);
	});
});
