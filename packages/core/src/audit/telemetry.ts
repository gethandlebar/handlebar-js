import { type AuditBus, type AuditSink, createAuditBus } from "./bus";
import { ConsoleSink, HttpSink } from "./sinks";

type TelemetryOptions = {
	apiKey?: string;
	endpoint?: string;
	defaultSinks?: ("http" | "console" | "file")[];
	filePath?: string;
	headers?: Record<string, string>;
};

class TelemetrySingleton {
	private _bus: AuditBus | null = null;
	private _inited = false;

	init(opts?: TelemetryOptions) {
		if (this._inited) {
			return;
		}

		this._inited = true;
		this._bus = createAuditBus();

		const endpoint = opts?.endpoint ?? process.env.HANDLEBAR_ENDPOINT;
		const apiKey = opts?.apiKey ?? process.env.HANDLEBAR_API_KEY;

		// TODO: remove default console log before publish.
		const defaults = opts?.defaultSinks ?? (apiKey ? ["http"] : ["console"]);

		const sinks: AuditSink[] = [];
		if (defaults.includes("console")) {
			sinks.push(ConsoleSink("json"));
		}

		if (defaults.includes("http") && endpoint) {
			const headers = {
				Authorization: apiKey ? `Bearer ${apiKey}` : "",
				...(opts?.headers ?? {}),
			};
			sinks.push(HttpSink(endpoint, headers));
		}

		// TODO: init file sink if configured.
		// TODO: logging if insufficient config, e.g. "http" option but no endpoint.

		this._bus.use(...sinks);
	}

	bus(): AuditBus | null {
		this.init();
		return this._bus;
	}

	addSink(sink: AuditSink) {
		this.init();
		if (this._bus) {
			this._bus.use(sink);
		}
	}
}

export const Telemetry = new TelemetrySingleton();
