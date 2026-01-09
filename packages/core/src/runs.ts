/**
 * Handlebar treats a "run" as a single execution of an agent.
 * E.g., in a chatbot a user message would trigger a run. The run would contain user messages as the inital prompt, agent actions, and a response from the agent.
 * Subsequent user message would trigger a new run, although these would be grouped in a session.
 */

import type {
	EndUserConfig,
	EndUserGroupConfig,
} from "@handlebar/governance-schema";

export type HandlebarRunOpts = {
	enduser?: EndUserConfig & { group?: EndUserGroupConfig };
};
