/**
 * Case-insensitive glob pattern (e.g. "search-*", "*-prod", "exact-name")
 */
export type Glob = string;

/**
 * JSON-safe value for condition parameters and custom function args.
 */
export type JSONValue =
	| string
	| number
	| boolean
	| null
	| { [k: string]: JSONValue }
	| JSONValue[];
