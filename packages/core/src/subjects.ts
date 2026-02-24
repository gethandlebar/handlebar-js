import type { SubjectSchema } from "@handlebar/governance-schema";
import type z from "zod";
import type { Run } from "./run";
import type { ToolMeta } from "./tool";

export type SubjectRef = z.infer<typeof SubjectSchema>;

export type SubjectExtractor = (args: {
	tool: ToolMeta;
	toolName: string;
	toolArgs: unknown;
	run: Run;
}) => SubjectRef[] | Promise<SubjectRef[]>;

export class SubjectRegistry {
	private byToolName = new Map<string, SubjectExtractor>();

	register(toolName: string, extractor: SubjectExtractor) {
		this.byToolName.set(toolName, extractor);
	}

	unregister(toolName: string) {
		this.byToolName.delete(toolName);
	}

	async extract(args: {
		tool: ToolMeta;
		toolName: string;
		toolArgs: unknown;
		run: Run;
	}): Promise<SubjectRef[]> {
		const extractor = this.byToolName.get(args.toolName);
		if (!extractor) {
			return [];
		}

		try {
			const out = await Promise.resolve(extractor(args));
			return out;
		} catch {
			// fail closed: no subjects produced
			return [];
		}
	}
}

export function sanitiseSubjects(subjects: SubjectRef[]): SubjectRef[] {
	return subjects.slice(0, 100).map((subject) => ({
		subjectType: subject.subjectType.slice(0, 256),
		value: subject.value.slice(0, 256),
		idSystem: subject.idSystem?.slice(0, 256),
		role: subject.role?.slice(0, 256),
	}));
}
