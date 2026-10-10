import { z } from "zod";
import type { Task } from "./domain";
import { IdentifierSchema, VersionSchema } from "./primitives";
import type { PlanningInput } from "./planner";
import { rankCandidates } from "./planner";

export const AssignmentPlanSchema = z.strictObject({
  eventId: IdentifierSchema,
  taskId: IdentifierSchema,
  participantId: IdentifierSchema.nullable(),
  eventVersion: VersionSchema,
  taskVersion: VersionSchema,
  requiresOrganizerApproval: z.literal(true),
  reasonCodes: z.array(z.string()),
});
export type AssignmentPlan = z.infer<typeof AssignmentPlanSchema>;

export function planAssignment(input: PlanningInput): AssignmentPlan {
  const ranking = rankCandidates(input);
  return AssignmentPlanSchema.parse({ eventId: input.event.id, taskId: input.task.id, participantId: ranking.candidates[0]?.participantId ?? null, eventVersion: input.event.version, taskVersion: input.task.version, requiresOrganizerApproval: true, reasonCodes: ranking.reasonCodes });
}
export function findAffectedTasks(tasks: readonly Task[], taskId: string): string[] {
  const root = tasks.find(task => task.id === taskId);
  if (!root) return [];
  const found = new Set([taskId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) if (task.eventId === root.eventId && !found.has(task.id) && task.dependsOnTaskIds?.some(id => found.has(id))) { found.add(task.id); changed = true; }
  }
  return [...found].sort();
}
