import { z } from "zod";

export const InbuiltAgentMetricKind = z.enum([
	"bytes_in",
	"bytes_out",
	"duration_ms",
	"records_in",
	"records_out",
	"llm_tokens_in",
	"llm_tokens_out",
	"llm_cost_usd",
]);
export const CustomAgentMetricKind = z
	.string()
	.regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/);

const AgentMetricInfo = z.object({
	value: z.number(),
	unit: z.string().min(1).max(64).optional(),
});

const InbuiltAgentMetrics = z.partialRecord(
	InbuiltAgentMetricKind,
	AgentMetricInfo,
);
const CustomAgentMetrics = z.record(CustomAgentMetricKind, AgentMetricInfo);

export const AgentMetrics = z.object({
	inbuilt: InbuiltAgentMetrics,
	custom: CustomAgentMetrics,
});
