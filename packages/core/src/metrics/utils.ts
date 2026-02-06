import type { MetricInfo } from "./types";

export function nowMs(): number {
	return globalThis.performance?.now?.() ?? Date.now();
}

export function approxBytes(value: unknown): number | undefined {
	if (value == null) {
		return 0;
	}

  if (Buffer.isBuffer(value)) {
		return value.byteLength;
	}

	if (value instanceof ArrayBuffer) {
		return value.byteLength;
  }

	if (ArrayBuffer.isView?.(value)) {
		return (value as ArrayBufferView).byteLength;
	}

	if (typeof value === "string") {
		return Buffer.byteLength(value, "utf8");
  }

	if (typeof value === "number" || typeof value === "boolean") {
		return Buffer.byteLength(String(value), "utf8");
	}

	// Arrays: rough estimate via JSON stringification
	try {
		return Buffer.byteLength(JSON.stringify(value), "utf8");
	} catch {
		return undefined;
	}
}

export function approxRecords(value: unknown): number | undefined {
	if (value == null) {
		return 0;
	}
	if (Array.isArray(value)) {
		return value.length;
	}

	// Common patterns
	if (typeof value === "object") {
		const v = value as any;
		if (Array.isArray(v.records)) {
			return v.records.length;
		}
		if (Array.isArray(v.items)) {
			return v.items.length;
		}
		if (typeof v.count === "number") {
			return v.count;
		}
	}

	return undefined;
}

export function validateMetricKey(key: string): boolean {
	return /^[a-zA-Z_0-9]{1,64}$/.test(key);
}

export function validateMetric(metric: MetricInfo): boolean {
	return !Number.isNaN(metric.value) && Number.isFinite(metric.value);
}
