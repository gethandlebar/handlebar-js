# Policy

A policy is a group of rules conveying some human meaning.
A policy also defines an agent matcher, indicating which agents the policy's rules are in-scope for.

The spec for defining a new policy (excluding associated rules) is:
```
{
	name: string,
	description?: string,
	enabled: boolean,
	agentSelector: {
	  anyOfSlugs?: string[],
		anyOfTags?: string[],
		allOfTags?: string[]
	},
	mode: "enforce" | "shadow",
	combine: "most_severe_wins",
}
```
