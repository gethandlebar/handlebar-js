export type MetricInfo = { value: number; unit?: string };
import { InbuiltAgentMetricKind as InbuiltAgentMetricKindSchema } from "@handlebar/governance-schema"
import type z from "zod";

export type InbuiltMetricKind = z.infer<typeof InbuiltAgentMetricKindSchema>;

const INBUILT: ReadonlySet<InbuiltMetricKind> = new Set([
  "bytes_in",
  "bytes_out",
  "duration_ms",
  "records_in",
  "records_out",
]);

const CUSTOM_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;

export class AgentMetricCollector {
  private inbuilt: Partial<Record<InbuiltMetricKind, MetricInfo>> = {};
  private custom: Record<string, MetricInfo> = {};

  private aggregation: {
    inbuilt: Partial<Record<InbuiltMetricKind, MetricInfo>>;
    custom: Record<string, MetricInfo>;
  } = {
    inbuilt: {},
    custom: {}
  };

  setInbuilt(kind: InbuiltMetricKind, value: number, unit?: string) {
    this.inbuilt[kind] = { value, unit };
  }

  addInbuilt(kind: InbuiltMetricKind, delta: number, unit?: string) {
    const prev = this.inbuilt[kind]?.value ?? 0;
    this.inbuilt[kind] = { value: prev + delta, unit: unit ?? this.inbuilt[kind]?.unit };
  }

  setCustom(kind: string, value: number, unit?: string) {
    const isInbuilt = InbuiltAgentMetricKindSchema.safeParse(kind);
    if (isInbuilt.success) { throw new Error(`Custom metric kind "${kind}" collides with inbuilt metric name`); }

    if (!CUSTOM_KEY_RE.test(kind)) { throw new Error(`Invalid custom metric key "${kind}"`); }

    this.custom[kind] = { value, unit };
  }

  addCustom(kind: string, delta: number, unit?: string) {
    if (!CUSTOM_KEY_RE.test(kind)) { throw new Error(`Invalid custom metric key "${kind}"`); }
    const prev = this.custom[kind]?.value ?? 0;
    this.custom[kind] = { value: prev + delta, unit: unit ?? this.custom[kind]?.unit };
  }

  aggregate() {
    for (const [metricKey, metricInfo] of Object.entries(this.inbuilt)) {
      const existing = this.aggregation.inbuilt[metricKey as InbuiltMetricKind];
      this.aggregation.inbuilt[metricKey as InbuiltMetricKind] = {
        value: existing ? existing.value + metricInfo.value : metricInfo.value,
        unit: existing?.unit ?? metricInfo.unit
      };
    }

    for (const [metricKey, metricInfo] of Object.entries(this.custom)) {
      const existing = this.aggregation.custom[metricKey];
      this.aggregation.custom[metricKey] = {
        value: existing ? existing.value + metricInfo.value : metricInfo.value,
        unit: existing?.unit ?? metricInfo.unit
      };
    }

    this.inbuilt = {};
    this.custom = {};
  }

  toEventPayload(opts: { aggregate?: boolean } = { aggregate: false }): { inbuilt: Record<string, MetricInfo>; custom: Record<string, MetricInfo> } | undefined {
    const inbuiltEntries = Object.entries(this.inbuilt).filter(([, v]) => v && Number.isFinite(v.value));
    const customEntries = Object.entries(this.custom).filter(([, v]) => v && Number.isFinite(v.value));

    if (opts?.aggregate) {
      this.aggregate();
    }

    if (inbuiltEntries.length === 0 && customEntries.length === 0) {
      return undefined;
    }

    return {
      inbuilt: Object.fromEntries(inbuiltEntries) as Record<string, MetricInfo>,
      custom: Object.fromEntries(customEntries) as Record<string, MetricInfo>,
    };
  }
}
