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

export const onboardingCopy = "Hi, I'm Rally. To join an event, ask its organizer for an invitation and text JOIN <code>. Text HELP for commands.";
export const helpCopy = "JOIN <code>, YES, NO, STATUS, STOP, PAUSE, RESUME, or LEAVE <event>. Only your own enrolled events are available.";
export const controlCopy = {
  stopped: "You've stopped Rally messages. Text RESUME to receive messages again.",
  paused: "Rally messages are paused. Text RESUME to continue.",
  active: "Rally messages are resumed for your enrolled events.",
} as const;
export const invalidJoinCopy = "I couldn't verify that invitation. Ask the organizer for a new code and text JOIN <code>.";
export const unavailableCopy = "That service isn't available yet. No assignment was changed. Please try again later.";

export const StatusCopySchema = z.strictObject({ events: z.array(z.strictObject({
  title: TextReferenceSchema,
  tasks: z.array(z.strictObject({ title: TextReferenceSchema, status: TaskStatusSchema, assigneeCount: z.number().int().nonnegative(), pendingCount: z.number().int().nonnegative() })),
})) });
export function renderStatus(input: z.infer<typeof StatusCopySchema>): string {
  const status = StatusCopySchema.parse(input);
  if (!status.events.length) return "You have no enrolled events.";
  return status.events.map((event) => `${event.title}:\n${event.tasks.length ? event.tasks.map((task) => `${task.title}: ${task.status.replaceAll("_", " ")}${task.status === "confirmed" ? ` (${task.assigneeCount} accepted)` : ""}${task.pendingCount ? `; ${task.pendingCount} awaiting response` : ""}`).join("\n") : "No tasks yet."}`).join("\n\n").slice(0, 4_000);
}

export function renderMessage(input: MessageCopyInput): string {
  const value = MessageCopyInputSchema.parse(input);
  switch (value.type) {
    case "onboarding": return onboardingCopy;
    case "proposal_request": return `${value.eventTitle}: Could you cover ${value.taskTitle}, ${value.windowLabel}? Reply YES or NO.`;
    case "proposal_pending": return `I asked ${value.participantName} to cover ${value.taskTitle}; still waiting for a response.`;
    case "assignment_confirmed": return `${value.participantName} accepted ${value.taskTitle}, ${value.windowLabel}. I've updated the assignment.`;
    case "delivery_failure": return `I couldn't reach ${value.participantName} yet. ${value.taskStatus === "confirmed" ? "The original assignment hasn't changed." : `${value.taskTitle} still needs coverage.`}`;
    case "clarification": return `Which event: ${value.choices[0]} or ${value.choices[1]}?`;
  }
}
