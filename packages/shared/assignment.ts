import { z } from "zod";
import type { Task } from "./domain";
import { IdentifierSchema, VersionSchema } from "./primitives";
import type { PlanningInput } from "./planner";

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

export function planAssignment(_input: PlanningInput): AssignmentPlan {
  throw new Error("NOT_IMPLEMENTED(lane-b)");
}
export function findAffectedTasks(_tasks: readonly Task[], _taskId: string): string[] {
  throw new Error("NOT_IMPLEMENTED(lane-b)");
}
