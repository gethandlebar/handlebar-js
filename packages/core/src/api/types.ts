export type ApiConfig = {
	apiEndpoint?: string;
	apiKey?: string;
};

export type AgentTool = {
	name: string;
	key: string;
	version: number;
	kind: "function";

	description?: string;
	metadata?: Record<string, string>;
};
