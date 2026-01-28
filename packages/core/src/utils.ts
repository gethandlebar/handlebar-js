import { createHash, randomInt } from "node:crypto";
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

// https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript
function mulberry32(a: number) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

function hashToSeed(input: string): number {
  const hash = createHash("sha256").update(input).digest();
  return hash.readUInt32LE(0);
}

const SLUG_PARTS = [
  "chainring",
  "spoke",
  "handlebar",
  "bell",
  "seatpost",
  "frame",
  "drivetrain",
  "cassette",
  "derailleur",
  "crankset",
  "saddle",
  "brake",
];

export function generateSlug(): string {
  const wd = process.cwd();
  const seed = hashToSeed(wd);
  const rand = mulberry32(seed);

  const parts = 4;
  const words = [];

  for (let i = 1; i <= parts; i++) {
    const idx = Math.floor(rand() * SLUG_PARTS.length);
    words.push(SLUG_PARTS[idx]);
  }

  return words.join("-");
}
