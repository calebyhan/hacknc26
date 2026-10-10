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

export function filterEligibleCandidates(_input: PlanningInput): string[] {
  throw new Error("NOT_IMPLEMENTED(lane-b)");
}
export function scoreCandidate(_input: PlanningInput, _participantId: string): CandidateScore {
  throw new Error("NOT_IMPLEMENTED(lane-b)");
}
export function rankCandidates(_input: PlanningInput): CandidateRanking {
  throw new Error("NOT_IMPLEMENTED(lane-b)");
}
