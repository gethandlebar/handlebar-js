import type { z } from "zod";
import type { InbuiltAgentMetricKind } from "../audit/run-metrics";
import type { Glob } from "./common";
import type { RuleEffectKind } from "./effects";

type MetricRef =
	| {
			kind: "inbuilt";
			key: z.infer<typeof InbuiltAgentMetricKind>;
	  }
	| { kind: "custom"; key: string };

export type MetricWindowCondition = {
	kind: "metricWindow";
	scope: "agent" | "agent_user";
	metric: MetricRef;
	aggregate: "sum" | "avg" | "max" | "min" | "count";
	windowSeconds: number;
	// optional filtering for which tool events count
	filter?: { toolName?: Glob | Glob[]; toolTag?: string | string[] };
	op: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
	value: number;
	onMissing?: RuleEffectKind; // default allow for metrics
};
