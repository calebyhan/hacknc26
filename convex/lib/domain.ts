import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { EventCreateInputSchema, TaskCreateInputSchema } from "../../packages/shared/domain";
import { memberFor } from "./auth";
import { canSend, openEnvelope } from "./messaging";
import { overlaps } from "../../packages/shared/planner";
import { eventDetail, eventSummary } from "./validators";
import type { Infer } from "convex/values";

export async function evidence(ctx: QueryCtx | MutationCtx, userId: Id<"users">, messageId: Id<"inboundMessages">) {
  const user = await ctx.db.get(userId), message = await ctx.db.get(messageId);
  if (!user?.verifiedPhoneE164 || !message || message.provider !== "spectrum" || message.senderPhone !== user.verifiedPhoneE164) throw new Error("UNAUTHORIZED");
  const envelope = await openEnvelope(message);
  return { user, message, text: envelope.text };
}
export async function audit(ctx: MutationCtx, eventId: Id<"events">, actorId: Id<"users"> | undefined, action: string, sourceId: string, data?: unknown, oldStateRef?: string) {
  const existing = await ctx.db.query("auditEvents").withIndex("by_source", q => q.eq("sourceId", sourceId)).unique();
  if (existing) return existing._id;
  return ctx.db.insert("auditEvents", { eventId, ...(actorId ? { actorId, actorType: "user" as const } : { actorType: "system" as const }), action, sourceId, at: Date.now(), ...(data !== undefined ? { newStateRef: JSON.stringify(data) } : {}), ...(oldStateRef ? { oldStateRef } : {}) });
}
export async function priorRequest<T>(ctx: QueryCtx | MutationCtx, source: string, input: unknown): Promise<T | undefined> {
  const record = await ctx.db.query("auditEvents").withIndex("by_source", q => q.eq("sourceId", source)).unique();
  if (!record) return undefined;
  const saved = JSON.parse(record.newStateRef!) as { input: unknown; result: T };
  if (canonicalJson(saved.input) !== canonicalJson(input)) throw new Error("IDEMPOTENCY_CONFLICT");
  return saved.result;
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
type Defined<T> = T extends (infer U)[] ? Defined<U>[] : T extends object ? { [K in keyof T]: Defined<Exclude<T[K], undefined>> } : T;
/** Convex optional fields must be absent, including nested validated input. */
export function defined<T>(value: T): Defined<T> { return JSON.parse(JSON.stringify(value)) as Defined<T>; }
export async function notify(ctx: MutationCtx, recipientUserId: Id<"users">, eventId: Id<"events">, content: string, idempotencyKey: string, proposalId?: Id<"proposals">, directReplyToMessageId?: Id<"inboundMessages">) {
  const row = { recipientUserId, eventId, content, idempotencyKey, ...(proposalId ? { proposalId } : {}), ...(directReplyToMessageId ? { directReplyToMessageId } : {}) };
  if (await canSend(ctx, row)) await ctx.runMutation(internal.outbox.enqueue, row);
}
export async function organizers(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  return (await ctx.db.query("memberships").withIndex("by_event", q => q.eq("eventId", eventId)).collect()).filter(m => m.state === "enrolled" && m.role === "organizer");
}
export async function notifyOrganizers(ctx: MutationCtx, eventId: Id<"events">, content: string, key: string, proposalId?: Id<"proposals">) {
  for (const m of await organizers(ctx, eventId)) await notify(ctx, m.userId, eventId, content, `${key}:${m.userId}`, proposalId);
}
export async function createEvent(ctx: MutationCtx, actorId: Id<"users">, raw: unknown): Promise<Id<"events">> {
  const input = EventCreateInputSchema.parse(raw), source = `event-create:${actorId}:${input.idempotencyKey}`;
  const existing = await priorRequest<Id<"events">>(ctx, source, input); if (existing) return existing;
  if (!await ctx.db.get(actorId)) throw new Error("UNAUTHORIZED");
  const { idempotencyKey: _, ...fields } = defined(input);
  const eventId = await ctx.db.insert("events", { ...fields, ownerId: actorId, status: "draft", version: 1 });
  // App membership is not messaging consent. JOIN must supply that evidence.
  await ctx.db.insert("memberships", { eventId, userId: actorId, role: "organizer", state: "enrolled", joinedAt: Date.now(), notificationsEnabled: false });
  await audit(ctx, eventId, actorId, "event_created", source, { input, result: eventId });
  return eventId;
}
export async function createTask(ctx: MutationCtx, actorId: Id<"users">, raw: unknown): Promise<Id<"tasks">> {
  const input = TaskCreateInputSchema.parse(raw), eventId = input.eventId as Id<"events">;
  const actor = await memberFor(ctx, actorId, eventId); if (actor.membership.role !== "organizer") throw new Error("UNAUTHORIZED");
  const source = `task-create:${eventId}:${actorId}:${input.idempotencyKey}`;
  const prior = await priorRequest<Id<"tasks">>(ctx, source, input); if (prior) return prior;
  const event = (await ctx.db.get(eventId))!;
  if (event.version !== input.expectedEventVersion) throw new Error("STALE_EVENT");
  if (event.status === "canceled" || event.status === "completed") throw new Error("EVENT_CLOSED");
  for (const id of input.dependsOnTaskIds ?? []) {
    const dependency = await ctx.db.get(id as Id<"tasks">);
    if (!dependency || dependency.eventId !== eventId || dependency.status === "canceled" || input.windowStart === undefined || dependency.windowEnd === undefined || dependency.windowEnd > input.windowStart) throw new Error("INVALID_DEPENDENCY");
  }
  const { idempotencyKey: _, expectedEventVersion: __, ...fields } = defined(input);
  const taskId = await ctx.db.insert("tasks", { ...fields, eventId, dependsOnTaskIds: (fields.dependsOnTaskIds ?? []) as Id<"tasks">[], capacity: fields.capacity ?? 1, status: "unassigned", version: 1 });
  await audit(ctx, eventId, actorId, "task_created", source, { input, result: taskId });
  return taskId;
}
export async function eligible(ctx: QueryCtx | MutationCtx, event: Doc<"events">, task: Doc<"tasks">, userId: Id<"users">, ignoreTask = false): Promise<boolean> {
  const member = await memberFor(ctx, userId, event._id);
  if (member.user.messagingState !== "active" || !member.user.verifiedPhoneE164 || !member.membership.notificationsEnabled || member.membership.consentAt === undefined || !member.membership.consentSourceMessageId) return false;
  const consent = await ctx.db.get(member.membership.consentSourceMessageId);
  if (consent?.senderPhone !== member.user.verifiedPhoneE164 || consent.provider !== "spectrum") return false;
  if (task.eventId !== event._id || event.status !== "scheduled" || task.status === "completed" || task.status === "canceled" || task.windowStart === undefined || task.windowEnd === undefined) return false;
  if (task.requiredSkills?.some(skill => !member.user.settings.skills?.includes(skill))) return false;
  const commitments = (await ctx.db.query("commitments").withIndex("by_participant", q => q.eq("participantId", userId)).collect()).filter(c => c.state === "active" && c.eventId === event._id);
  for (const c of commitments) {
    if (c.taskId === task._id) { if (ignoreTask) continue; return false; }
    const other = await ctx.db.get(c.taskId);
    if (!other || other.windowStart === undefined || other.windowEnd === undefined || overlaps(task.windowStart, task.windowEnd, other.windowStart, other.windowEnd)) return false;
  }
  for (const id of task.dependsOnTaskIds ?? []) {
    const dependency = await ctx.db.get(id);
    if (!dependency || dependency.eventId !== event._id || dependency.status === "canceled" || dependency.windowEnd === undefined || dependency.windowEnd > task.windowStart) return false;
  }
  const available = (await ctx.db.query("availability").withIndex("by_event_user", q => q.eq("eventId", event._id).eq("userId", userId)).collect()).filter(a => overlaps(task.windowStart!, task.windowEnd!, a.windowStart, a.windowEnd));
  return !available.some(a => a.kind === "unavailable" && !available.some(newer => newer.kind === "available" && newer.recordedAt > a.recordedAt && newer.windowStart <= a.windowStart && newer.windowEnd >= a.windowEnd));
}
export function summarizeEvent(event: Doc<"events">, role: "organizer" | "member"): Infer<typeof eventSummary> {
  const { _id, title, kind, startsAt, timezone, status, version, location } = event;
  return { _id, title, kind, startsAt, timezone, status, version, role, ...(location !== undefined ? { location } : {}) };
}
export async function detailFor(ctx: QueryCtx | MutationCtx, userId: Id<"users">, eventId: Id<"events">): Promise<Infer<typeof eventDetail>> {
  const membership = (await memberFor(ctx, userId, eventId)).membership, event = (await ctx.db.get(eventId))!;
  const tasks = await ctx.db.query("tasks").withIndex("by_event", q => q.eq("eventId", eventId)).collect();
  const commitments = (await ctx.db.query("commitments").withIndex("by_event", q => q.eq("eventId", eventId)).collect()).filter(c => c.state === "active");
  const proposals = await ctx.db.query("proposals").withIndex("by_event", q => q.eq("eventId", eventId)).collect();
  const validPending = (p: Doc<"proposals">) => p.state === "pending" && p.expiresAt > Date.now() && p.eventVersionAtCreation === event.version && (!p.targetTaskId || tasks.some(t => t._id === p.targetTaskId && t.version === p.taskVersionAtCreation));
  const memberships = await ctx.db.query("memberships").withIndex("by_event", q => q.eq("eventId", eventId)).collect();
  return {
    event: summarizeEvent(event, membership.role),
    tasks: tasks.map(({ _id, eventId, title, capacity, status, version, location, windowStart, windowEnd }) => {
      const pending = proposals.filter(p => p.targetTaskId === _id && validPending(p));
      const displayLabel = status === "completed" || status === "canceled" ? status : pending.some(p => p.requiresOrganizerApproval && !p.organizerApprovedAt) ? "pending_approval" : pending.length ? "awaiting_participant" : status === "confirmed" ? "confirmed" : "needs_coverage";
      return { _id, eventId, title, capacity, status, version, displayLabel, activeAssigneeIds: commitments.filter(c => c.taskId === _id).map(c => c.participantId), ...(location !== undefined ? { location } : {}), ...(windowStart !== undefined ? { windowStart } : {}), ...(windowEnd !== undefined ? { windowEnd } : {}) };
    }),
    members: await Promise.all(memberships.map(async m => ({ userId: m.userId, displayName: (await ctx.db.get(m.userId))?.displayName ?? "Participant", role: m.role, state: m.state, ...(m.state === "invited" ? { displayLabel: "waiting_to_join" } : {}) }))),
    proposals: proposals.map(p => ({ _id: p._id, eventId, type: p.type, state: p.state === "pending" && !validPending(p) ? "expired" as const : p.state, requiresOrganizerApproval: p.requiresOrganizerApproval, expiresAt: p.expiresAt, ...(p.targetTaskId ? { targetTaskId: p.targetTaskId } : {}), ...(p.targetUserId ? { targetUserId: p.targetUserId } : {}), ...(p.organizerApprovedAt !== undefined ? { organizerApprovedAt: p.organizerApprovedAt } : {}), ...(validPending(p) ? { displayLabel: p.requiresOrganizerApproval && p.organizerApprovedAt === undefined ? "pending_approval" : "awaiting_participant" } : {}) })),
  };
}
