import { z } from "zod";

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

export const SensitiveDataDetectorSchema = z.enum([
	"email", //         RFC 5322 email address
	"email_domain", //  email address; domain checked via subCondition
	"phone", //         E.164 and common national formats
	"credit_card", //   Visa/MC/Amex/Discover with Luhn validation
	"iban", //          ISO 13616 IBAN (EU/UK bank accounts)
	"uk_nino", //       UK National Insurance Number (AB 123456 C)
	"ip_address", //    IPv4 and IPv6
	"url", //           HTTP/HTTPS URL; scheme/domain checked via subCondition
	"jwt", //           JSON Web Token (xxxxx.yyyyy.zzzzz)
	"private_key", //   PEM-encoded private key block
	"secret_key", //    High-entropy string resembling an API key / token
]);
export type SensitiveDataDetector = z.infer<typeof SensitiveDataDetectorSchema>;

// ---------------------------------------------------------------------------
// Sub-conditions — further filter on the detected value
// Only meaningful for: email_domain (check: "domain" | "tld")
//                      url          (check: "scheme" | "domain" | "tld")
// ---------------------------------------------------------------------------

const SubConditionValueSchema = z.union([
	z.string().min(1),
	z.array(z.string().min(1)).min(1),
]);

export const SensitiveDataSubConditionSchema = z.discriminatedUnion("check", [
	z
		.object({
			check: z.literal("domain"),
			op: z.enum(["eq", "neq", "endsWith", "in"]),
			value: SubConditionValueSchema,
		})
		.strict(),
	z
		.object({
			check: z.literal("tld"),
			op: z.enum(["eq", "neq", "in"]),
			value: SubConditionValueSchema,
		})
		.strict(),
	z
		.object({
			check: z.literal("scheme"),
			op: z.enum(["eq", "neq", "in"]),
			value: SubConditionValueSchema,
		})
		.strict(),
]);
export type SensitiveDataSubCondition = z.infer<
	typeof SensitiveDataSubConditionSchema
>;

// ---------------------------------------------------------------------------
// Detector entry — one detector, with an optional sub-condition
// ---------------------------------------------------------------------------

const SensitiveDataDetectorEntrySchema = z
	.object({
		detector: SensitiveDataDetectorSchema,
		subCondition: SensitiveDataSubConditionSchema.optional(),
	})
	.strict();
export type SensitiveDataDetectorEntry = z.infer<
	typeof SensitiveDataDetectorEntrySchema
>;

// ---------------------------------------------------------------------------
// Condition
//
// Scans tool argument values for sensitive data patterns.
// Multiple detectors can be combined in one condition:
//   op "anyOf" (default) — triggers if any detector finds a match
//   op "allOf"           — triggers only if all detectors match
//
// ---------------------------------------------------------------------------

export const SensitiveDataConditionSchema = z
	.object({
		kind: z.literal("sensitiveData"),
		/** Surface to scan. "toolOutput" and others will be added later. */
		target: z.literal("toolArg"),
		/**
		 * Dot-path into the argument object (e.g. "user.email").
		 * When absent, all string leaf values in the argument object are scanned.
		 */
		path: z.string().min(1).max(200).optional(),
		/** How detectors are combined. Defaults to "anyOf". */
		op: z.enum(["anyOf", "allOf"]).default("anyOf"),
		/** At least one detector entry required. */
		detectors: z.array(SensitiveDataDetectorEntrySchema).min(1),
	})
	.strict();
export type SensitiveDataCondition = z.infer<
	typeof SensitiveDataConditionSchema
>;
