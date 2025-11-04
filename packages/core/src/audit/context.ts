import { AsyncLocalStorage } from "node:async_hooks";

export interface RunCtx {
	runId: string;
	userCategory?: string;
	stepIndex?: number;
	decisionId?: string;
	otel?: { traceId?: string; spanId?: string };
}

const als = new AsyncLocalStorage<RunCtx>();

export function withRunContext<T>(ctx: RunCtx, fn: () => T): T {
	return als.run(ctx, fn);
}

export function getRunContext(): RunCtx | undefined {
	return als.getStore();
}

export function setDecisionId(id: string | undefined) {
	const ctx = als.getStore();
	if (ctx) ctx.decisionId = id;
}
export function incStep() {
	const ctx = als.getStore();
	if (ctx) ctx.stepIndex = (ctx.stepIndex ?? 0) + 1;
}
