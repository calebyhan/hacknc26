import { z } from "zod";
import { TaskStatusSchema } from "./enums";
import { TextReferenceSchema } from "./primitives";

export const MessageCopyInputSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("onboarding") }),
  z.strictObject({ type: z.literal("proposal_request"), eventTitle: TextReferenceSchema, taskTitle: TextReferenceSchema, windowLabel: TextReferenceSchema }),
  z.strictObject({ type: z.literal("proposal_pending"), participantName: TextReferenceSchema, taskTitle: TextReferenceSchema }),
  z.strictObject({ type: z.literal("assignment_confirmed"), participantName: TextReferenceSchema, taskTitle: TextReferenceSchema, windowLabel: TextReferenceSchema }),
  z.strictObject({ type: z.literal("delivery_failure"), participantName: TextReferenceSchema, taskTitle: TextReferenceSchema, taskStatus: TaskStatusSchema }),
  z.strictObject({ type: z.literal("clarification"), choices: z.array(TextReferenceSchema).min(2).max(2) }),
]);
export type MessageCopyInput = z.infer<typeof MessageCopyInputSchema>;

export function renderMessage(_input: MessageCopyInput): string {
  throw new Error("NOT_IMPLEMENTED(lane-a)");
}
