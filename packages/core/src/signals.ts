import type { Tool, ToolCall, RunContext } from "./types";
import type { SubjectRef } from "./subjects";
import type { SignalCondition, SignalBinding, SignalSchema } from "@handlebar/governance-schema";
import { stableJson } from "./utils";
import type z from "zod";

export type SignalProvider<TValue = unknown> = (args: Record<string, unknown>) => TValue | Promise<TValue>;
export type SignalResult = { ok: true; value: unknown } | { ok: false; error: unknown }

export type SignalEvalEnv<T extends Tool = Tool> = {
  ctx: RunContext<T>;
  call: ToolCall<T>;
  subjects: SubjectRef[];
};

type Signal = z.infer<typeof SignalSchema>;

type Cached =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown };

export function resultToSignalSchema(key: string, result: SignalResult): Signal | undefined {
  try {
    if (result.ok) {
      const resultValue = JSON.stringify(result.value).slice(0, 256);
      return {
        key,
        result: { ok: true, value: resultValue },
        args: undefined,
      };
    } else {
      return {
        key,
        result: { ok: false, error: String(result.error) },
        args: undefined,
      };
    }
  } catch {
    return undefined;
  }
}

function getByDotPath(obj: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cur: any = obj;

  for (const p of parts) {
    if (cur == null) {
      return undefined;
    }
    cur = cur[p];
  }
  return cur;
}

export function compareSignal(op: SignalCondition["op"], left: unknown, right: unknown): boolean {
  switch (op) {
    case "eq":  return left === right;
    case "neq": return left !== right;
    case "gt":  return typeof left === "number" && typeof right === "number" && left > right;
    case "gte": return typeof left === "number" && typeof right === "number" && left >= right;
    case "lt":  return typeof left === "number" && typeof right === "number" && left < right;
    case "lte": return typeof left === "number" && typeof right === "number" && left <= right;
    case "in": {
      if (!Array.isArray(right)) return false;
      return right.some(v => v === left);
    }
    case "nin": {
      if (!Array.isArray(right)) return false;
      return !right.some(v => v === left);
    }
    default:
      return false;
  }
}

export class SignalRegistry {
  private providers = new Map<string, SignalProvider>();

  register(key: string, provider: SignalProvider) {
    this.providers.set(key, provider);
  }

  unregister(key: string) {
    this.providers.delete(key);
  }

  has(key: string) {
    return this.providers.has(key);
  }

  private bind(binding: SignalBinding, env: SignalEvalEnv): unknown {
    switch (binding.from) {
      case "endUserId":
        return env.ctx.enduser?.externalId;

      case "endUserTag":
        return env.ctx.enduser?.metadata?.[binding.tag];

      case "toolName":
        return env.call.tool.name;

      case "toolTag": {
        const tags = (env.call.tool.categories ?? []).map((t) => t.toLowerCase());
        return tags.includes(binding.tag.toLowerCase());
      }

      case "toolArg":
        return getByDotPath(env.call.args, binding.path);

      case "subject": {
        const matches = env.subjects
          .filter((s) => (s.subjectType === binding.subjectType) && (binding.role ? s.role === binding.role : true));

        const s0 = matches[0];
        if (!s0) { return undefined; }

        const field = binding.field ?? "id";
        return field === "idSystem" ? s0.idSystem : s0.value;
      }

      case "const":
        return binding.value;
    }
  }

  /**
   * Evaluate a signal with per-call caching.
   */
  async eval(
    key: string,
    args: Record<string, SignalBinding>,
    env: SignalEvalEnv,
    cache: Map<string, Cached>,
  ): Promise<SignalResult> {
    const provider = this.providers.get(key);
    if (!provider) {
      return { ok: false, error: "Missing provider" };
    }

    const boundArgs: Record<string, unknown> = {};
    for (const [k, b] of Object.entries(args ?? {})) {
      boundArgs[k] = this.bind(b, env);
    }

    const cacheKey = `${key}:${stableJson(boundArgs)}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached.ok ? { ok: true, value: cached.value } : { ok: false, error: cached.error };
    }

    try {
      const value = await Promise.resolve(provider(boundArgs));
      cache.set(cacheKey, { ok: true, value });
      return { ok: true, value };
    } catch (error) {
      cache.set(cacheKey, { ok: false, error });
      return { ok: false, error };
    }
  }
}

export function sanitiseSignals(signals: Signal[]): Signal[] {
  return signals.slice(100).map(signal => ({
    key: signal.key.slice(256),
    result: signal.result.ok ? { ok: true, value: signal.result.value.slice(256) } : signal.result,
    args: signal.args?.slice(100).map(a => a.slice(256)),
  }));
}
