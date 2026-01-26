import type { JSONValue } from "./common";

/**
 * Delegate condition evaluation to a user-defined function.
 * - `name` is resolved by the host SDK/application
 * - `args` is an opaque, JSON-serializable payload consumed by user code
 */
export type CustomFunctionCondition = {
	kind: "custom";
	name: string;
	args?: JSONValue;
};
