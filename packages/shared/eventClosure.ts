import { z } from "zod";
import { IdentifierSchema, VersionSchema } from "./primitives";
import { TaskStatusSchema } from "./enums";

export const EVENT_CLOSURE_TTL_MS = 5 * 60_000;
export const EventClosureCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("review"), eventRef: z.string().trim().min(1).max(256) }),
  z.strictObject({ type: z.literal("confirm") }), z.strictObject({ type: z.literal("cancel") }), z.strictObject({ type: z.literal("usage") }),
]);
export const EventClosureSnapshotSchema = z.strictObject({
  ownerId: IdentifierSchema,
  tasks: z.array(z.strictObject({ taskId: IdentifierSchema, version: VersionSchema, status: TaskStatusSchema })).max(100),
  activeCommitmentIds: z.array(IdentifierSchema).max(500),
  pendingProposalIds: z.array(IdentifierSchema).max(500),
  pendingInvitationIds: z.array(IdentifierSchema).max(500),
});
export type EventClosureSnapshot = z.infer<typeof EventClosureSnapshotSchema>;
export function parseEventClosureCommand(text: string): z.infer<typeof EventClosureCommandSchema> | null {
  const normalized = text.trim().toLowerCase().replace(/\s+/gu, " ");
  if (/^yes, close it[.!]?$/u.test(normalized)) return { type: "confirm" };
  if (/^cancel close[.!?]*$/u.test(normalized)) return { type: "cancel" };
  if (normalized === "close event") return { type: "usage" };
  const match = /^close event\s+(.+)$/iu.exec(text.trim());
  if (!match) return null;
  const command = EventClosureCommandSchema.safeParse({ type: "review", eventRef: match[1]!.trim() });
  return command.success ? command.data : { type: "usage" };
}
export function eventClosureReview(title: string, snapshot: EventClosureSnapshot): string {
  const safeTitle = title.replace(/[\s\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+/gu, " ").trim();
  const tasks = snapshot.tasks.filter(task => !["canceled", "completed"].includes(task.status)).length;
  return `Review closing ${safeTitle}:\n${snapshot.activeCommitmentIds.length} active assignment(s) will be released.\n${snapshot.pendingProposalIds.length} pending offer(s) will be canceled.\n${tasks} unfinished task(s) will be canceled.\n${snapshot.pendingInvitationIds.length} pending invitation(s) will be revoked.\n\nThe event will be marked canceled and removed from active phone STATUS. Its history is retained, not deleted. Other events stay unchanged. Enrolled participants with message consent will be notified.\nReply "yes, close it" within 5 minutes to confirm, or "cancel close". Nothing has changed yet.`;
}
