import { z } from "zod";

export const EndUserConfigSchema = z.object({
	externalId: z.string(), // A Handlebar user's ID for _their_ user
	// TODO: make metadata optional.
	metadata: z.record(z.string(), z.string()).optional(), // Arbitrary labels to attach to the user.
	name: z.string().optional(),
});

// For now they're the same, but defining separately as they will likely diverge.
export const EndUserGroupConfigSchema = EndUserConfigSchema;

export type EndUserConfig = z.infer<typeof EndUserConfigSchema>;
export type EndUserGroupConfig = z.infer<typeof EndUserGroupConfigSchema>;
