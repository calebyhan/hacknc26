import type { Infer } from "convex/values";
import { pendingCounts, renderStatus } from "../../packages/shared/copy";
import type { eventDetail } from "./validators";

/** Only pass details produced for the verified caller by domain.statusFor or
 * detailFor, after any channel-specific consent filter. No global roster reads. */
export function renderStatusDetails(details: readonly Infer<typeof eventDetail>[]): string {
  const now = Date.now();
  const active = details.filter(detail => !["canceled", "completed"].includes(detail.event.status));
  if (details.length && !active.length) return "You have no active events. Closed events remain available in the app.";
  return renderStatus({ events: active.map(detail => {
    const people = new Map(detail.members.filter(member => member.state === "enrolled").map(member => [member.userId, member.displayName]));
    let dates: Intl.DateTimeFormat;
    try { dates = new Intl.DateTimeFormat("en-US", { timeZone: detail.event.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }); }
    catch { dates = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }); }
    return { title: detail.event.title, eventId: detail.event._id, tasks: detail.tasks.filter(task => task.eventId === detail.event._id).map(task => {
      const assignees = [...new Set(task.activeAssigneeIds)];
      // detailFor already marks snapshot-stale offers expired. Recheck scope,
      // wall-clock expiry and terminal tasks at the rendering boundary as well.
      const proposals = detail.proposals.filter(proposal => proposal.eventId === detail.event._id && proposal.targetTaskId === task._id && proposal.state === "pending" && proposal.expiresAt > now && !["completed", "canceled"].includes(task.status));
      return {
        title: task.title, status: task.status, capacity: task.capacity,
        assigneeCount: assignees.length, assigneeNames: assignees.map(id => people.get(id) ?? "Participant"),
        ...pendingCounts(proposals, task._id),
        pendingOffers: proposals.map(proposal => ({
          participantName: proposal.targetUserId ? people.get(proposal.targetUserId) ?? "Participant" : "Participant",
          awaiting: proposal.requiresOrganizerApproval && proposal.organizerApprovedAt === undefined ? "organizer" as const : "participant" as const,
          deadlineLabel: dates.format(proposal.expiresAt),
        })),
      };
    }) };
  }) });
}
