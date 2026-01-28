/**
 * Match on arbitrary tags assigned to the enduser.
 * "enduser" in this context means the users of a Handlebar user.
 * - has: existence AND truthiness of the tag. E.g. "has:tier" would be false if "tier=0", "tier=false", or no "tier" tag exists.
 * - hasValue: tag exists and has an exact given value
 */
export type EndUserTagCondition =
	| { kind: "enduserTag"; op: "has"; tag: string }
	| { kind: "enduserTag"; op: "hasValue"; tag: string; value: string }
	| { kind: "enduserTag"; op: "hasValueAny"; tag: string; values: string[] };
