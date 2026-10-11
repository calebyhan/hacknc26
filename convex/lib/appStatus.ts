import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { type AppActivityItem, type AppProgress, type AppRoute } from "../../packages/shared/appStatus";
import { PhoneE164Schema } from "../../packages/shared/primitives";
import { parseCommand } from "../../packages/shared/commands";
import { reviewedCreateConfirmation } from "../../packages/shared/phoneConversation";
import { openEnvelope } from "./messaging";

export const ROUTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_LIMIT = 30;

/** Only a caller-owned app phone challenge may expose this bot address before
 * phone proof. It grants no identity, membership, consent, or messaging rights. */
export async function phoneChallengeRoute(ctx: QueryCtx, phone: string, expiresAt: number): Promise<AppRoute> {
  const record = await ctx.db.query("messagingRoutes").withIndex("by_participant_phone", q => q.eq("participantPhoneE164", phone)).unique();
  const provision = record?.provisioning;
  const now = Date.now();
  if (record?.revokedAt !== undefined || !provision || !validTimestamp(provision.verifiedAt) || provision.verifiedAt > now
    || !validTimestamp(provision.expiresAt) || provision.expiresAt <= now || expiresAt <= now
    || provision.expiresAt <= provision.verifiedAt || provision.expiresAt > provision.verifiedAt + ROUTE_MAX_AGE_MS
    || !PhoneE164Schema.safeParse(provision.destination).success || provision.destination === phone) return { status: "unavailable" };
  const route = await resolvePhoneRoute(ctx, phone);
  return route.status === "available" ? { ...route, expiresAt: Math.min(expiresAt, route.expiresAt) } : route;
}

export async function eventProgress(ctx: QueryCtx, eventId: Id<"events">): Promise<AppProgress> {
  const tasks = await ctx.db.query("tasks").withIndex("by_event", q => q.eq("eventId", eventId)).collect();
  const result = { total: tasks.length, confirmed: 0, needsCoverage: 0, completed: 0, canceled: 0 };
  for (const task of tasks) {
    if (task.status === "unassigned" || task.status === "needs_coverage") result.needsCoverage++;
    else result[task.status]++;
  }
  return result;
}

export async function messagingStatus(ctx: QueryCtx, user: Doc<"users">, membership: Doc<"memberships">) {
  let consentRecorded = false;
  if (user.verifiedPhoneE164 && membership.consentAt !== undefined && Number.isSafeInteger(membership.consentAt)
    && membership.consentAt >= 0 && membership.consentAt <= Date.now() && membership.consentSourceMessageId) {
    const message = await ctx.db.get(membership.consentSourceMessageId);
    if (message?.provider === "spectrum" && message.senderPhone === user.verifiedPhoneE164) {
      try {
        const text = (await openEnvelope(message)).text;
        consentRecorded = parseCommand(text).type === "JOIN";
        if (!consentRecorded && reviewedCreateConfirmation(text)) {
          const receipt = await ctx.db.query("auditEvents").withIndex("by_source", q => q.eq("sourceId", `phone-consent:${message._id}`)).unique();
          consentRecorded = receipt?.action === "guided_event_consent" && receipt.actorId === user._id && receipt.eventId === membership.eventId;
        }
      }
      catch { /* Missing or invalid evidence is never displayed as consent. */ }
    }
  }
  return {
    membershipState: membership.state,
    consentRecorded,
    notificationsEnabled: membership.notificationsEnabled,
    messagingState: user.messagingState,
    canReceiveMessages: membership.state === "enrolled" && consentRecorded && membership.notificationsEnabled && user.messagingState === "active",
  };
}

const actionTitles: ReadonlyMap<string, Extract<AppActivityItem, { kind: "domain" }>["title"]> = new Map([
  ["event_created", "Event created"], ["event_confirmed", "Event confirmed"], ["task_created", "Task created"],
  ["proposal_created", "Request created"], ["organizer_approved", "Organizer approval recorded"],
  ["proposal_expired", "Request expired"], ["proposal_superseded", "Request replaced"], ["proposal_canceled", "Request canceled"],
  ["proposal_declined", "Request declined"], ["task_change_approved", "Task change approved"],
  ["task_change_committed", "Task change committed"], ["assignment_committed", "Assignment committed"],
  ["organizer_unavailability_override", "Commitment canceled"], ["self_canceled", "Commitment canceled"],
  ["self_commitment_recorded", "Commitment recorded"], ["invitee_draft_added", "Invitee draft added"],
]);

export async function eventActivity(ctx: QueryCtx, eventId: Id<"events">, userId: Id<"users">): Promise<AppActivityItem[]> {
  const [audit, deliveries] = await Promise.all([
    ctx.db.query("auditEvents").withIndex("by_event_at", q => q.eq("eventId", eventId)).order("desc").take(ACTIVITY_LIMIT),
    ctx.db.query("outboundMessages").withIndex("by_event_recipient", q => q.eq("eventId", eventId).eq("recipientUserId", userId)).order("desc").take(ACTIVITY_LIMIT),
  ]);
  const result: AppActivityItem[] = [];
  for (const row of audit) {
    const title = actionTitles.get(row.action);
    if (title && Number.isSafeInteger(row.at) && row.at >= 0) result.push({ id: `domain:${row._id}`, kind: "domain", at: row.at, title });
  }
  for (const row of deliveries) result.push({ id: `delivery:${row._id}`, kind: "delivery", at: Math.floor(row._creationTime), title: "Message created for you", deliveryState: row.state });
  return result.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, ACTIVITY_LIMIT);
}

/**
 * Current verified caller only. The provider's shared sentinel and the incoming
 * sender/space ID are not the Rally destination. Component routing metadata is
 * sticky, so consult the newest signed/encrypted observation instead. Missing,
 * invalid or expired evidence never revives an older line. The shared sentinel
 * alone supplies no destination; a current trusted allocation may supply it.
 */
export async function currentRoute(ctx: QueryCtx, user: Doc<"users">): Promise<AppRoute> {
  return resolvePhoneRoute(ctx, user.verifiedPhoneE164);
}

async function resolvePhoneRoute(ctx: QueryCtx, phone: string | undefined): Promise<AppRoute> {
  if (!phone || !PhoneE164Schema.safeParse(phone).success) return { status: "unavailable" };
  const now = Date.now();
  const record = await ctx.db.query("messagingRoutes").withIndex("by_participant_phone", q => q.eq("participantPhoneE164", phone)).unique();
  const provisioning = record?.provisioning;
  if (record && (record.revokedAt !== undefined || !provisioning || !validTimestamp(provisioning.verifiedAt)
    || !validTimestamp(provisioning.expiresAt) || provisioning.verifiedAt > now || provisioning.expiresAt <= now
    || provisioning.expiresAt > provisioning.verifiedAt + ROUTE_MAX_AGE_MS || provisioning.expiresAt <= provisioning.verifiedAt
    || !PhoneE164Schema.safeParse(provisioning.destination).success || provisioning.destination === phone)) return { status: "unavailable" };
  const latest = await ctx.db.query("inboundMessages").withIndex("by_sender_received_at", q => q.eq("senderPhone", phone)).order("desc").first();
  if (provisioning && (!latest || latest.receivedAt <= provisioning.verifiedAt)) {
    return { status: "available", destination: provisioning.destination, expiresAt: provisioning.expiresAt };
  }
  if (!latest || latest.provider !== "spectrum" || !validTimestamp(latest.receivedAt) || latest.receivedAt > now
    || latest.receivedAt + ROUTE_MAX_AGE_MS <= now) return { status: "unavailable" };
  try {
    const { linePhone } = await openEnvelope(latest);
    if (linePhone === "shared" && provisioning) {
      // "shared" is an SDK sentinel, not evidence that Photon changed the
      // operator-verified allocation. Retain it only while all later bounded
      // observations agree; a rotated/invalid line must never be resurrected.
      const observations = await ctx.db.query("inboundMessages").withIndex("by_sender_received_at", q => q.eq("senderPhone", phone).gt("receivedAt", provisioning.verifiedAt)).order("desc").take(31);
      if (observations.length >= 31) return { status: "unavailable" };
      for (const observation of observations) {
        if (observation.provider !== "spectrum" || observation.receivedAt > now) return { status: "unavailable" };
        const observedLine = (await openEnvelope(observation)).linePhone;
        if (observedLine !== "shared" && observedLine !== provisioning.destination) return { status: "unavailable" };
      }
      return { status: "available", destination: provisioning.destination, expiresAt: provisioning.expiresAt };
    }
    if (!linePhone || !PhoneE164Schema.safeParse(linePhone).success || linePhone === phone) return { status: "unavailable" };
    return { status: "available", destination: linePhone, expiresAt: latest.receivedAt + ROUTE_MAX_AGE_MS };
  } catch { return { status: "unavailable" }; }
}

function validTimestamp(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
