import type z from "zod";
import type { RunContext, Tool, ToolMeta } from "./types";
import type { SubjectSchema } from "@handlebar/governance-schema";

export type SubjectRef = z.infer<typeof SubjectSchema>;

export type SubjectExtractor<T extends Tool = Tool> = (args: {
  tool: ToolMeta<T>;
  toolName: string;
  toolArgs: unknown;
  runContext: RunContext<T>;
}) => SubjectRef[] | Promise<SubjectRef[]>;

export class SubjectRegistry<T extends Tool = Tool> {
  private byToolName = new Map<string, SubjectExtractor<T>>();

  register(toolName: string, extractor: SubjectExtractor<T>) {
    this.byToolName.set(toolName, extractor);
  }

  unregister(toolName: string) {
    this.byToolName.delete(toolName);
  }

  async extract(args: {
    tool: ToolMeta<T>;
    toolName: string;
    toolArgs: unknown;
    runContext: RunContext<T>;
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
  return subjects.slice(0, 100).map(subject => ({
    subjectType: subject.subjectType.slice(0, 256),
    value: subject.value.slice(0, 256),
    idSystem: subject.idSystem?.slice(0, 256),
    role: subject.role?.slice(0, 256),
  }))
}
