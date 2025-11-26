import type { ISO8601 } from "./types";

export function millisecondsSince(initialTime: number): number {
	return Math.round((performance.now() - initialTime) * 1000) / 1000;
}

export function now(): ISO8601 {
	return new Date().toISOString();
}
