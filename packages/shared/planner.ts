import { z } from "zod";
import { AvailabilitySchema, CommitmentSchema, EventSchema, MembershipSchema, TaskSchema, UserSchema } from "./domain";
import { IdentifierSchema, TimestampSchema } from "./primitives";

export const PlanningInputSchema = z.strictObject({
  event: EventSchema,
  task: TaskSchema,
  users: z.array(UserSchema),
  memberships: z.array(MembershipSchema),
  tasks: z.array(TaskSchema),
  commitments: z.array(CommitmentSchema),
  availability: z.array(AvailabilitySchema),
  now: TimestampSchema,
});
export const CandidateScoreSchema = z.strictObject({
  participantId: IdentifierSchema,
  score: z.number(),
  reasonCodes: z.array(z.string()),
});
export const CandidateRankingSchema = z.strictObject({
  candidates: z.array(CandidateScoreSchema),
  reasonCodes: z.array(z.string()),
});
export type PlanningInput = z.infer<typeof PlanningInputSchema>;
export type CandidateScore = z.infer<typeof CandidateScoreSchema>;
export type CandidateRanking = z.infer<typeof CandidateRankingSchema>;

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
export function filterEligibleCandidates(raw: PlanningInput): string[] {
  const input = PlanningInputSchema.parse(raw), task = input.task;
  if (task.eventId !== input.event.id || input.event.status !== "scheduled" || task.status === "completed" || task.status === "canceled" || task.windowStart === undefined || task.windowEnd === undefined) return [];
  if ((task.dependsOnTaskIds ?? []).some(id => {
    const dependency = input.tasks.find(t => t.id === id && t.eventId === input.event.id);
    return !dependency || dependency.status === "canceled" || dependency.windowEnd === undefined || dependency.windowEnd > task.windowStart!;
  })) return [];
  const active = input.commitments.filter(c => c.eventId === input.event.id && c.state === "active");
  if (active.filter(c => c.taskId === task.id).length >= task.capacity) return [];
  return input.users.filter(user => {
    if (!user.verifiedPhoneE164 || user.messagingState !== "active") return false;
    const membership = input.memberships.find(m => m.eventId === input.event.id && m.userId === user.id);
    if (membership?.state !== "enrolled" || !membership.notificationsEnabled || membership.consentAt === undefined || !membership.consentSourceMessageId) return false;
    if ((task.requiredSkills ?? []).some(skill => !user.settings.skills?.includes(skill))) return false;
    if (active.some(c => c.participantId === user.id && (c.taskId === task.id || (() => {
      const other = input.tasks.find(t => t.id === c.taskId && t.eventId === input.event.id);
      return !other || other.windowStart === undefined || other.windowEnd === undefined || overlaps(task.windowStart!, task.windowEnd!, other.windowStart, other.windowEnd);
    })()))) return false;
    const evidence = input.availability.filter(a => a.eventId === input.event.id && a.userId === user.id && overlaps(task.windowStart!, task.windowEnd!, a.windowStart, a.windowEnd));
    return !evidence.some(a => a.kind === "unavailable" && !evidence.some(newer => newer.kind === "available" && newer.recordedAt > a.recordedAt && newer.windowStart <= a.windowStart && newer.windowEnd >= a.windowEnd));
  }).map(user => user.id).sort();
}
export function scoreCandidate(raw: PlanningInput, participantId: string): CandidateScore {
  const input = PlanningInputSchema.parse(raw);
  if (!filterEligibleCandidates(input).includes(participantId)) throw new Error("INELIGIBLE_CANDIDATE");
  const user = input.users.find(u => u.id === participantId)!;
  const available = input.availability.some(a => a.eventId === input.event.id && a.userId === participantId && a.source === "self_reported" && a.kind === "available" && a.windowStart <= input.task.windowStart! && a.windowEnd >= input.task.windowEnd!);
  const skilled = (input.task.requiredSkills?.length ?? 0) > 0 && input.task.requiredSkills!.every(skill => user.settings.skills?.includes(skill));
  const workload = input.commitments.filter(c => c.eventId === input.event.id && c.participantId === participantId && c.state === "active").length;
  return { participantId, score: 3 * Number(available) + 2 * Number(skilled) - 2 * workload - 1, reasonCodes: [available ? "EXPLICIT_AVAILABILITY" : "AVAILABILITY_UNKNOWN_REQUIRES_CONFIRMATION", ...(skilled ? ["REQUIRED_SKILLS_PRESENT"] : []), "ORGANIZER_APPROVAL_REQUIRED", "PARTICIPANT_ACCEPTANCE_REQUIRED"] };
}
export function rankCandidates(raw: PlanningInput): CandidateRanking {
  const input = PlanningInputSchema.parse(raw);
  const candidates = filterEligibleCandidates(input).map(id => scoreCandidate(input, id)).sort((a, b) => b.score - a.score || (a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0));
  return { candidates, reasonCodes: candidates.length ? ["CANDIDATES_REQUIRE_APPROVAL"] : ["NO_ELIGIBLE_CANDIDATE"] };
}
