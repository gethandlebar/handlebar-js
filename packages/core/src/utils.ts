import type { ISO8601 } from "./types";

export function millisecondsSince(initialTime: number): number {
	return Math.round((performance.now() - initialTime) * 1000) / 1000;
}

export function now(): ISO8601 {
	return new Date().toISOString();
}

/**
 * JSON stringify with sorted keys for plain objects
 */
export function stableJson(v: unknown): string {
  const seen = new WeakSet<object>();

  const norm = (x: any): any => {
    if (x && typeof x === "object") {
      if (seen.has(x)) {
        return "[Circular]";
      }

      seen.add(x);

      if (Array.isArray(x)) {
        return x.map(norm);
      }
      const keys = Object.keys(x).sort();
      const out: any = {};

      for (const k of keys) {
        out[k] = norm(x[k]);
      }

      return out;
    }
    return x;
  };

  return JSON.stringify(norm(v));
}
