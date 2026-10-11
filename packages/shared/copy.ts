import { z } from "zod";
import { TaskStatusSchema, type ProposalState } from "./enums";
import { IdentifierSchema, TextReferenceSchema } from "./primitives";

export const MessageCopyInputSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("onboarding") }),
  z.strictObject({ type: z.literal("proposal_request"), eventTitle: TextReferenceSchema, taskTitle: TextReferenceSchema, windowLabel: TextReferenceSchema }),
  z.strictObject({ type: z.literal("proposal_pending"), participantName: TextReferenceSchema, taskTitle: TextReferenceSchema }),
  z.strictObject({ type: z.literal("assignment_confirmed"), participantName: TextReferenceSchema, taskTitle: TextReferenceSchema, windowLabel: TextReferenceSchema }),
  z.strictObject({ type: z.literal("delivery_failure"), participantName: TextReferenceSchema, taskTitle: TextReferenceSchema, taskStatus: TaskStatusSchema }),
  z.strictObject({ type: z.literal("clarification"), choices: z.array(TextReferenceSchema).min(2).max(2) }),
]);
export type MessageCopyInput = z.infer<typeof MessageCopyInputSchema>;

export const onboardingCopy = 'Hi, I’m Rally. Text "create an event" and I’ll walk you through it. If an organizer invited this phone, text "join" followed by the event name, or use their JOIN code. Text HELP for more options.';
export const helpCopy = 'Plan with "create an event", "invite someone", or "add a task". After saving a task, send the next task’s name or "done". I’ll show a review before saving. Join an invitation for this phone with "join <event name>". Reply YES or NO to an offer; include the task name when you have several. Organizers can say "approve <task name>"; the participant must still accept. If warned about an overlap, "confirm overlap <task name>" accepts it explicitly. Ask "what’s my status" to see your events. Organizers can review ending an old event with "close event <event name>". STOP, PAUSE, RESUME and LEAVE <event name> control messages. Existing codes and expert commands still work.';
export const controlCopy = {
  stopped: "You've stopped Rally messages. Text RESUME to receive messages again.",
  paused: "Rally messages are paused. Text RESUME to continue.",
  active: "Rally messages are resumed for your enrolled events.",
} as const;
export const invalidJoinCopy = `I couldn't verify that invitation for this phone. Ask the organizer to invite this number, then text "join <event name>". If names overlap, ask them for the original JOIN code. No event access changed.`;
export const phoneLinkProofCopy = "Phone proof received. Return to Rally and tap Check phone verification to finish linking your account.";
export const unavailableCopy = "That service isn't available yet. No assignment was changed. Please try again later.";

export const StatusCopySchema = z.strictObject({ events: z.array(z.strictObject({
  title: TextReferenceSchema,
  eventId: IdentifierSchema.optional(),
  tasks: z.array(z.strictObject({
    title: TextReferenceSchema, status: TaskStatusSchema,
    assigneeCount: z.number().int().nonnegative(), pendingCount: z.number().int().nonnegative(), approvalCount: z.number().int().nonnegative().optional(),
    capacity: z.number().int().positive().optional(),
    assigneeNames: z.array(TextReferenceSchema).optional(),
    pendingOffers: z.array(z.strictObject({ participantName: TextReferenceSchema, awaiting: z.enum(["organizer", "participant"]), deadlineLabel: TextReferenceSchema })).optional(),
  })),
})) });
/** Input must already be scoped/version-checked by the domain read model. */
export function pendingCounts(proposals: readonly { targetTaskId?: string; state: ProposalState; requiresOrganizerApproval: boolean; organizerApprovedAt?: number }[], taskId: string): { pendingCount: number; approvalCount: number } {
  const pending = proposals.filter(p => p.state === "pending" && p.targetTaskId === taskId);
  const approvalCount = pending.filter(p => p.requiresOrganizerApproval && p.organizerApprovedAt === undefined).length;
  return { pendingCount: pending.length - approvalCount, approvalCount };
}
export function renderStatus(input: z.infer<typeof StatusCopySchema>): string {
  const status = StatusCopySchema.parse(input);
  if (!status.events.length) return "You have no enrolled events.";
  const titles = new Map<string, number>();
  for (const event of status.events) {
    const key = event.title.toLowerCase();
    titles.set(key, (titles.get(key) ?? 0) + 1);
  }
  const line = (value: string) => value.replace(/[\s\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+/gu, " ").trim();
  const text = status.events.map((event) => {
    const label = event.eventId && titles.get(event.title.toLowerCase())! > 1 ? `${line(event.title)} [${event.eventId}]` : line(event.title);
    return `${label}:\n${event.tasks.length ? event.tasks.map((task) => {
      const closed = task.status === "completed" || task.status === "canceled";
      const approvals = task.pendingOffers?.filter(offer => offer.awaiting === "organizer");
      const responses = task.pendingOffers?.filter(offer => offer.awaiting === "participant");
      const approvalCount = closed ? 0 : approvals?.length ?? task.approvalCount ?? 0;
      const pendingCount = closed ? 0 : responses?.length ?? task.pendingCount;
      const names = (offers: typeof approvals, action: string) => offers?.length ? `: ${offers.map(offer => `${line(offer.participantName)} (${action} by ${line(offer.deadlineLabel)})`).join(", ")}` : "";
      const staffing = !closed && task.capacity !== undefined ? `; ${task.assigneeCount}/${task.capacity} confirmed${task.assigneeNames?.length ? `: ${task.assigneeNames.map(line).join(", ")}` : ""}` : "";
      return `${line(task.title)}: ${task.status.replaceAll("_", " ")}${task.status === "confirmed" ? ` (${task.assigneeCount} accepted)` : ""}${approvalCount ? `; ${approvalCount} awaiting organizer approval${names(approvals, "approve")}` : ""}${pendingCount ? `; ${pendingCount} awaiting response${names(responses, "reply")}` : ""}${staffing}`;
    }).join("\n") : "No tasks yet."}`;
  }).join("\n\n");
  return text.length <= 4_000 ? text : `${text.slice(0, 3_998).trimEnd()}…`;
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
