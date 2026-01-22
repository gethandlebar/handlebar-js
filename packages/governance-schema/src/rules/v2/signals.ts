import type { JSONValue } from "../condition.types";
import type { RuleEffectKind } from "./effects";

/**
 * Requires the existence of subject data at runtime.
 *
 * Handlebar is agnostic to the source of the data,
 * so long as it is present in the engine runtime.
 */
export type RequireSubjectCondition = {
	kind: "requireSubject";
	subjectType: string; // subject class. E.g. patient/account/portfolio/document.
	// idSystem: human-understandable namespace for kind of data subject represents.
	// E.g. "ehr_patient_id"; "crm_contact_id
	idSystem?: string;
};

type SignalBinding =
	| { from: "endUserId" }
	| { from: "toolArg"; path: string } // Dot-path
	| {
			from: "subject";
			subjectType: string;
			role?: string; // e.g. "primary" | "source" | "dest". For when they are multiple items within a subject type.
			field?: "id" | "idSystem";
	  }
	| { from: "const"; value: JSONValue };

export type SignalCondition = {
	kind: "signal";
	key: string;
	args: Record<string, SignalBinding>;
	op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "nin";
	value: JSONValue;
	onMissing?: RuleEffectKind;
};
