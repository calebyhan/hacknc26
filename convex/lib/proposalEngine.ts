import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { memberFor } from "./auth";
import { audit, canonicalJson, captureOverlap, eligible, evidence, notify, organizers, priorRequest } from "./domain";
import { ProposeTaskChangeActionSchema } from "../../packages/shared/agentDecision";
import { IdempotencyKeySchema, OverlapWarningSchema } from "../../packages/shared/domain";
import type { OverlapWarning } from "../../packages/shared/domain";
import { TimestampSchema, VersionSchema } from "../../packages/shared/primitives";
import { parseCommand, proposalReferenceMatches } from "../../packages/shared/commands";
import { mentionsReference } from "./taskInstructions";

export interface CreateProposalArgs {
  eventId: Id<"events">; originatorId: Id<"users">; sourceMessageId: Id<"inboundMessages">;
  type: "assignment" | "reassignment" | "task_change"; subjectId?: Id<"users">; targetTaskId?: Id<"tasks">; targetUserId?: Id<"users">;
  taskChangeJson?: string; expectedEventVersion: number; expectedTaskVersion?: number; expiresAt: number; idempotencyKey: string;
}
function windowLabel(task: Pick<Doc<"tasks">, "windowStart" | "windowEnd">, event: Doc<"events">): string {
  const format = new Intl.DateTimeFormat("en-US", { timeZone: event.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return task.windowStart !== undefined && task.windowEnd !== undefined ? `${format.format(task.windowStart)}–${format.format(task.windowEnd)} (${event.timezone})` : "time to be confirmed";
}
function deadlineLabel(expiresAt: number, event: Doc<"events">): string {
  const format = new Intl.DateTimeFormat("en-US", { timeZone: event.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${format.format(expiresAt)} (${event.timezone})`;
}
export async function sendRequest(ctx: MutationCtx, proposal: Doc<"proposals">) {
  const task = await ctx.db.get(proposal.targetTaskId!), event = (await ctx.db.get(proposal.eventId))!;
  if (!task || !proposal.targetUserId) throw new Error("INVALID_PROPOSAL");
  const reply = `Reply YES or NO by ${deadlineLabel(proposal.expiresAt, event)}.`;
  const content = proposal.type === "task_change" ? `${event.title}: Please reconfirm ${task.title} with this proposed change: ${changeLabel(proposal.taskChangeJson!)}. ${reply} Current details remain unchanged until everyone accepts.` : `${event.title}: Could you cover ${task.title}, ${windowLabel(task, event)}? ${reply} No assignment has changed yet.`;
  await notify(ctx, proposal.targetUserId, proposal.eventId, content, `proposal:${proposal._id}:request:${proposal.targetUserId}`, proposal._id);
}
export interface ApprovalOption {
  proposal: Doc<"proposals">; event: Doc<"events">; task: Doc<"tasks">; target: Doc<"users">; reference: string;
}
function approvalLabels(option: Omit<ApprovalOption, "reference">): string[] {
  return [option.task.title, `${option.task.title} for ${option.event.title}`, `${option.task.title} for ${option.target.displayName}`, `${option.task.title} for ${option.target.displayName} at ${option.event.title}`];
}
export function approvalReferenceMatches(reference: string, option: Omit<ApprovalOption, "reference">): boolean {
  return proposalReferenceMatches(reference, option.proposal._id, option.task.title, option.event.title)
    || approvalLabels(option).some(label => label.toLowerCase() === reference.trim().toLowerCase());
}
/** A reply label must resolve against the same current, authorized set shown
 * to this organizer. Unconsented, expired or snapshot-stale rows do not collide. */
export async function getApprovalOptions(ctx: MutationCtx, actorId: Id<"users">): Promise<ApprovalOption[]> {
  const actor = await ctx.db.get(actorId);
  if (actor?.messagingState !== "active" || !actor.verifiedPhoneE164) return [];
  const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", actorId)).collect();
  const options: Omit<ApprovalOption, "reference">[] = [];
  for (const membership of memberships) {
    if (membership.state !== "enrolled" || membership.role !== "organizer" || membership.consentAt === undefined || !membership.consentSourceMessageId) continue;
    const proof = await ctx.db.get(membership.consentSourceMessageId), event = await ctx.db.get(membership.eventId);
    if (proof?.provider !== "spectrum" || proof.senderPhone !== actor.verifiedPhoneE164 || event?.status !== "scheduled") continue;
    const offers = await ctx.db.query("proposals").withIndex("by_event", q => q.eq("eventId", event._id)).collect();
    for (const proposal of offers) {
      if (!proposal.requiresOrganizerApproval || proposal.organizerApprovedAt !== undefined) continue;
      const task = await currentReplyTask(ctx, proposal, true);
      const target = proposal.targetUserId ? await ctx.db.get(proposal.targetUserId) : null;
      if (task && target) options.push({ proposal, event, task, target });
    }
  }
  return options.map(option => {
    const labels = [...approvalLabels(option), option.proposal._id.slice(-6).toUpperCase()];
    const reference = labels.find(label => !/[\r\n]/u.test(label) && label.length <= 256 && options.filter(candidate => approvalReferenceMatches(label, candidate)).length === 1) ?? option.proposal._id;
    return { ...option, reference };
  });
}
async function sendApprovalRequest(ctx: MutationCtx, proposal: Doc<"proposals">, event: Doc<"events">, task: Doc<"tasks">) {
  const target = (await ctx.db.get(proposal.targetUserId!))!;
  for (const organizer of await organizers(ctx, event._id)) {
    const option = (await getApprovalOptions(ctx, organizer.userId)).find(item => item.proposal._id === proposal._id);
    if (!option) continue;
    const reference = option.reference;
    const self = organizer.userId === target._id;
    const content = `${event.title}: Approval needed for ${target.displayName} to cover ${task.title}. Text APPROVE ${reference}. ${self ? "You'll then receive an offer and must reply YES separately" : "They still need to accept"} by ${deadlineLabel(proposal.expiresAt, event)}. No assignment has changed.`;
    await notify(ctx, organizer.userId, event._id, content, `proposal:${proposal._id}:approval:${organizer.userId}`, proposal._id);
  }
}
function changeLabel(json: string): string {
  const action = ProposeTaskChangeActionSchema.parse(JSON.parse(json));
  return action.field === "location" ? `location ${action.newValue}` : `time ${action.newValue.startsAt}–${action.newValue.endsAt}`;
}
function changedTask(task: Doc<"tasks">, taskChangeJson?: string): Doc<"tasks"> {
  if (!taskChangeJson) return task;
  const action = ProposeTaskChangeActionSchema.parse(JSON.parse(taskChangeJson));
  return { ...task, ...(action.field === "location" ? { location: action.newValue } : { windowStart: Date.parse(action.newValue.startsAt), windowEnd: Date.parse(action.newValue.endsAt) }) };
}
function readWarning(proposal: Doc<"proposals">): OverlapWarning | undefined {
  if (!proposal.overlapWarningJson) return undefined;
  return OverlapWarningSchema.parse(JSON.parse(proposal.overlapWarningJson));
}
async function warnOverlap(ctx: MutationCtx, proposal: Doc<"proposals">, event: Doc<"events">, task: Doc<"tasks">, sourceMessageId: Id<"inboundMessages">, state: Awaited<ReturnType<typeof captureOverlap>>) {
  const warning = OverlapWarningSchema.parse({ snapshot: state.snapshot, sourceMessageId, warnedAt: Date.now() });
  await ctx.db.patch(proposal._id, { state: "pending", overlapWarningJson: canonicalJson(warning) });
  const localNames = [...new Set(state.conflicts.filter(c => c.eventId === event._id).map(c => c.title))];
  const elsewhere = state.conflicts.filter(c => c.eventId !== event._id);
  const privateTimes = elsewhere.slice(0, 3).map(conflict => `another event commitment (${windowLabel(conflict, event)})`);
  const labels = [...localNames.slice(0, 3).map(name => `your ${name}`), ...(localNames.length > 3 ? ["other tasks in this event"] : []), ...privateTimes, ...(elsewhere.length > 3 ? ["other event commitments"] : [])];
  const reference = await proposalReplyReference(ctx, proposal.targetUserId!, proposal._id);
  const content = state.conflicts.length ? `${event.title}: ${task.title} overlaps with ${labels.join(", ")}. Nothing changed. To accept anyway, reply CONFIRM OVERLAP ${reference} by ${deadlineLabel(proposal.expiresAt, event)}.` : `${event.title}: Your schedule changed and ${task.title} no longer overlaps. Nothing changed. Reply YES ${reference} again by ${deadlineLabel(proposal.expiresAt, event)} to accept the current offer.`;
  await notify(ctx, proposal.targetUserId!, event._id, content, `proposal:${proposal._id}:overlap:${sourceMessageId}`, proposal._id);
  await audit(ctx, event._id, proposal.targetUserId, "overlap_warning", `overlap-warning:${proposal._id}:${sourceMessageId}`, { proposalId: proposal._id, conflictCount: state.conflicts.length });
}
async function checkOverlapConsent(ctx: MutationCtx, proposal: Doc<"proposals">, event: Doc<"events">, task: Doc<"tasks">, args: ResponseArgs, explicitConfirmation: boolean, receivedAt: number): Promise<boolean> {
  const state = await captureOverlap(ctx, event, task, args.actorId), warning = readWarning(proposal);
  if (explicitConfirmation) {
    if (!warning || receivedAt < warning.warnedAt || warning.sourceMessageId === args.sourceMessageId) throw new Error("OVERLAP_WARNING_REQUIRED");
    if (canonicalJson(warning.snapshot) !== canonicalJson(state.snapshot) || !state.conflicts.length) {
      await warnOverlap(ctx, proposal, event, task, args.sourceMessageId, state); return false;
    }
    await ctx.db.patch(proposal._id, { overlapWarningJson: canonicalJson(OverlapWarningSchema.parse({ ...warning, confirmedByMessageId: args.sourceMessageId })) });
    return true;
  }
  if (state.conflicts.length) { await warnOverlap(ctx, proposal, event, task, args.sourceMessageId, state); return false; }
  if (warning) await ctx.db.patch(proposal._id, { overlapWarningJson: undefined });
  return true;
}

/** Only commitment changes preserve these snapshots. Time/definition changes
 * still invalidate offers. Shared by accepted offers and explicit self-volunteers. */
export async function advanceCompatibleOffers(ctx: MutationCtx, previousTask: Doc<"tasks">, exceptProposalId?: Id<"proposals">): Promise<void> {
  const task = (await ctx.db.get(previousTask._id))!;
  const pending = (await ctx.db.query("proposals").withIndex("by_event", q => q.eq("eventId", task.eventId)).collect()).filter(p => p._id !== exceptProposalId && p.targetTaskId === task._id && p.state === "pending" && p.taskVersionAtCreation === previousTask.version);
  const current = (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", task._id)).collect()).filter(c => c.state === "active");
  for (const proposal of pending) {
    const newTarget = proposal.targetUserId && !current.some(c => c.participantId === proposal.targetUserId);
    const compatible = newTarget && (proposal.type === "assignment" ? current.length < task.capacity : proposal.type === "reassignment" && current.some(c => c.participantId === proposal.subjectId));
    if (compatible) {
      const warning = readWarning(proposal);
      let overlapWarningJson = proposal.overlapWarningJson;
      if (warning && proposal.targetUserId) {
        const event = (await ctx.db.get(task.eventId))!;
        const { snapshot } = await captureOverlap(ctx, event, task, proposal.targetUserId);
        // Another teammate taking an independent slot did not change this
        // person's overlap. Preserve the same warning only for that exact case.
        if (canonicalJson({ ...snapshot, taskVersion: warning.snapshot.taskVersion }) === canonicalJson(warning.snapshot)) overlapWarningJson = canonicalJson({ ...warning, snapshot });
      }
      await ctx.db.patch(proposal._id, { taskVersionAtCreation: task.version, ...(overlapWarningJson ? { overlapWarningJson } : {}) });
    }
    else await closeProposal(ctx, proposal, "superseded", "Another acceptance changed this task. Ask for a new offer.");
  }
}
export async function createProposal(ctx: MutationCtx, raw: CreateProposalArgs, forceApproval = false, expandGroup = true): Promise<Id<"proposals">> {
  const args = { ...raw, idempotencyKey: IdempotencyKeySchema.parse(raw.idempotencyKey), expectedEventVersion: VersionSchema.parse(raw.expectedEventVersion), ...(raw.expectedTaskVersion !== undefined ? { expectedTaskVersion: VersionSchema.parse(raw.expectedTaskVersion) } : {}), expiresAt: TimestampSchema.parse(raw.expiresAt) };
  await evidence(ctx, args.originatorId, args.sourceMessageId);
  const originator = await memberFor(ctx, args.originatorId, args.eventId);
  const source = `proposal-create:${args.originatorId}:${args.idempotencyKey}`;
  const input = { ...args, forceApproval };
  const prior = await priorRequest<Id<"proposals">>(ctx, source, input); if (prior) return prior;
  const event = (await ctx.db.get(args.eventId))!;
  if (event.status !== "scheduled" || event.version !== args.expectedEventVersion) throw new Error("STALE_EVENT");
  if (args.expiresAt <= Date.now() || args.expiresAt > Date.now() + 86400000) throw new Error("INVALID_PROPOSAL_TTL");
  if (!args.targetTaskId || !args.targetUserId || args.expectedTaskVersion === undefined) throw new Error("INVALID_PROPOSAL");
  const task = await ctx.db.get(args.targetTaskId);
  if (!task || task.eventId !== event._id || task.version !== args.expectedTaskVersion) throw new Error("STALE_TASK");
  const commitments = (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", task._id)).collect()).filter(c => c.state === "active");
  let taskChangeJson: string | undefined;
  if (args.type === "task_change") {
    if (originator.membership.role !== "organizer" || !args.taskChangeJson || args.subjectId) throw new Error("UNAUTHORIZED");
    const action = ProposeTaskChangeActionSchema.parse(JSON.parse(args.taskChangeJson));
    if (action.taskRef !== task._id && action.taskRef.toLowerCase() !== task.title.toLowerCase()) throw new Error("INVALID_TASK_REFERENCE");
    taskChangeJson = canonicalJson(action);
    const affected = commitments.map(c => c.participantId);
    if (affected.length ? !affected.includes(args.targetUserId) : args.targetUserId !== args.originatorId) throw new Error("INVALID_CHANGE_TARGET");
    // One grouped offer per active assignee; all must reconfirm the same snapshot.
    if (!await eligible(ctx, event, changedTask(task, taskChangeJson), args.targetUserId, true, true)) throw new Error("INELIGIBLE_TARGET");
  } else {
    if (args.taskChangeJson) throw new Error("INVALID_PROPOSAL");
    if (!await eligible(ctx, event, task, args.targetUserId, false, true)) throw new Error("INELIGIBLE_TARGET");
    if (args.type === "reassignment") {
      if (!args.subjectId || args.subjectId === args.targetUserId || !commitments.some(c => c.participantId === args.subjectId)) throw new Error("INVALID_REPLACEMENT");
    } else if (args.subjectId || commitments.length >= task.capacity) throw new Error("TASK_FULL");
  }
  const requiresOrganizerApproval = forceApproval || (originator.membership.role !== "organizer" && args.targetUserId !== args.originatorId);
  const fields = { eventId: args.eventId, type: args.type, originatorId: args.originatorId, ...(args.subjectId ? { subjectId: args.subjectId } : {}), targetTaskId: task._id, targetUserId: args.targetUserId, ...(taskChangeJson ? { taskChangeJson } : {}), state: "pending" as const, requiresOrganizerApproval, eventVersionAtCreation: event.version, taskVersionAtCreation: task.version, expiresAt: args.expiresAt, idempotencyKey: args.idempotencyKey };
  const proposalId = await ctx.db.insert("proposals", fields);
  await audit(ctx, event._id, args.originatorId, "proposal_created", source, { input, result: proposalId });
  await ctx.scheduler.runAt(args.expiresAt, internal.proposals.expire, { proposalId });
  if (requiresOrganizerApproval) await sendApprovalRequest(ctx, (await ctx.db.get(proposalId))!, event, task);
  else await sendRequest(ctx, (await ctx.db.get(proposalId))!);
  if (args.type === "task_change" && expandGroup) {
    for (const commitment of commitments.filter(c => c.participantId !== args.targetUserId)) {
      const siblingKey = `${args.idempotencyKey.slice(0, 70)}:change:${commitment.participantId}`;
      await createProposal(ctx, { ...args, targetUserId: commitment.participantId, idempotencyKey: siblingKey }, false, false);
    }
  }
  return proposalId;
}
export async function approveProposal(ctx: MutationCtx, proposalId: Id<"proposals">, actorId: Id<"users">, source: string): Promise<null> {
  const p = await ctx.db.get(proposalId);
  if (!p) throw new Error("UNAUTHORIZED");
  if ((await memberFor(ctx, actorId, p.eventId)).membership.role !== "organizer") throw new Error("UNAUTHORIZED");
  if (p.state !== "pending") return null;
  const event = (await ctx.db.get(p.eventId))!, task = p.targetTaskId ? await ctx.db.get(p.targetTaskId) : null;
  if (!task || p.expiresAt <= Date.now() || event.version !== p.eventVersionAtCreation || task.version !== p.taskVersionAtCreation || event.status !== "scheduled") { await closeProposal(ctx, p, "expired", "This offer changed before organizer approval.", actorId); return null; }
  if (!p.requiresOrganizerApproval || p.organizerApprovedAt !== undefined) return null;
  await ctx.db.patch(p._id, { organizerApprovedAt: Date.now() });
  await audit(ctx, p.eventId, actorId, "organizer_approved", `proposal:${p._id}:organizer-approved`, { source });
  await sendRequest(ctx, (await ctx.db.get(p._id))!);
  return null;
}
async function group(ctx: MutationCtx, p: Doc<"proposals">) {
  const all = await ctx.db.query("proposals").withIndex("by_event", q => q.eq("eventId", p.eventId)).collect();
  return all.filter(q => q.type === "task_change" && q.targetTaskId === p.targetTaskId && q.originatorId === p.originatorId && q.taskVersionAtCreation === p.taskVersionAtCreation && q.eventVersionAtCreation === p.eventVersionAtCreation && q.taskChangeJson === p.taskChangeJson && q.expiresAt === p.expiresAt);
}
export async function closeProposal(ctx: MutationCtx, p: Doc<"proposals">, state: "expired" | "superseded" | "canceled" | "declined", explanation: string, actorId?: Id<"users">, messageId?: Id<"inboundMessages">) {
  if (p.state !== "pending") return;
  await ctx.db.patch(p._id, { state });
  await audit(ctx, p.eventId, actorId, `proposal_${state}`, `proposal:${p._id}:closed`, { state }, "pending");
  const task = p.targetTaskId ? await ctx.db.get(p.targetTaskId) : null;
  let content = `${task?.title ?? "Offer"}: ${explanation} No new assignment was made from this offer.`;
  if (state === "superseded" && task?.eventId === p.eventId) {
    const active = (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", task._id)).collect()).filter(commitment => commitment.state === "active" && commitment.eventId === p.eventId);
    if (active.length >= task.capacity) {
      const names: string[] = [];
      for (const commitment of active) {
        const membership = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", p.eventId).eq("userId", commitment.participantId)).unique();
        const person = membership?.state === "enrolled" ? await ctx.db.get(commitment.participantId) : null;
        names.push(person?.displayName ?? "A participant");
      }
      const covering = names.slice(0, 5).map(name => name.replace(/[\r\n]/gu, " ").slice(0, 80)).join(", ") + (names.length > 5 ? ` and ${names.length - 5} others` : "");
      content = `${task.title}: ${covering} ${names.length === 1 ? "is" : "are"} covering this task. It is fully staffed, and this offer is closed.`;
    }
  }
  const recipients = new Set([p.originatorId, ...(p.targetUserId ? [p.targetUserId] : [])]);
  for (const recipient of recipients) await notify(ctx, recipient, p.eventId, content, `proposal:${p._id}:closed:${recipient}`, p._id, recipient === actorId ? messageId : undefined);
}
interface ResponseArgs { proposalId: Id<"proposals">; actorId: Id<"users">; sourceMessageId: Id<"inboundMessages">; response: "accept" | "decline" }
async function currentReplyTask(ctx: MutationCtx, proposal: Doc<"proposals">, includeUnapproved = false): Promise<Doc<"tasks"> | null> {
  if (proposal.state !== "pending" || proposal.expiresAt <= Date.now() || (!includeUnapproved && proposal.requiresOrganizerApproval && proposal.organizerApprovedAt === undefined) || !proposal.targetUserId || !proposal.targetTaskId) return null;
  const member = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", proposal.eventId).eq("userId", proposal.targetUserId!)).unique();
  if (member?.state !== "enrolled" || member.consentAt === undefined || !member.consentSourceMessageId) return null;
  const user = await ctx.db.get(proposal.targetUserId), proof = await ctx.db.get(member.consentSourceMessageId);
  if (user?.messagingState !== "active" || !user.verifiedPhoneE164 || proof?.provider !== "spectrum" || proof.senderPhone !== user.verifiedPhoneE164) return null;
  const event = await ctx.db.get(proposal.eventId), task = await ctx.db.get(proposal.targetTaskId);
  return event?.status === "scheduled" && event.version === proposal.eventVersionAtCreation && task?.eventId === event._id && task.version === proposal.taskVersionAtCreation && task.status !== "completed" && task.status !== "canceled" ? task : null;
}
/** Reference matching is scoped to this participant's current authorized offers. */
export async function resolveProposalReplyReference(ctx: MutationCtx, actorId: Id<"users">, reference: string): Promise<Id<"proposals"> | null> {
  const proposals = await ctx.db.query("proposals").withIndex("by_target", q => q.eq("targetUserId", actorId)).collect();
  const matches: Id<"proposals">[] = [];
  for (const proposal of proposals) {
    const task = await currentReplyTask(ctx, proposal);
    const event = task ? await ctx.db.get(proposal.eventId) : null;
    if (task && proposalReferenceMatches(reference, proposal._id, task.title, event?.title)) matches.push(proposal._id);
  }
  return matches.length === 1 ? matches[0]! : null;
}
/** Prefer a task name that the participant can actually send back. Use a
 * qualified name, then a code only if current authorized offers still collide. */
export async function proposalReplyReference(ctx: MutationCtx, actorId: Id<"users">, proposalId: Id<"proposals">): Promise<string> {
  const proposal = await ctx.db.get(proposalId), task = proposal ? await currentReplyTask(ctx, proposal) : null;
  const event = proposal && task ? await ctx.db.get(proposal.eventId) : null;
  if (proposal && task && event) {
    for (const reference of [task.title, `${task.title} for ${event.title}`, proposalId.slice(-6).toUpperCase()]) {
      const parsed = parseCommand(`YES ${reference}`);
      if (parsed.type === "YES" && parsed.proposalRef === reference && await resolveProposalReplyReference(ctx, actorId, reference) === proposalId) return reference;
    }
  }
  return proposalId;
}
/** Deliberately conservative: asking somebody else is not self-acceptance. */
export function explicitSelfAcceptance(text: string, taskTitle: string): boolean {
  const normalized = text.replace(/[’‘]/gu, "'").trim();
  const firstPerson = /^(?:I\s+(?:can|will|volunteer\s+to)|I'll)\s+(.+)$/iu.exec(normalized);
  if (!firstPerson || /\b(?:maybe|probably|might|can't|cannot|won't|not|if)\b/iu.test(normalized) || !mentionsReference(normalized, taskTitle)) return false;
  const responsibility = firstPerson[1]!;
  return /^(?:help|cover|do|bring|handle|take|run|work)\b/iu.test(responsibility) || responsibility.toLowerCase().startsWith(taskTitle.toLowerCase());
}
/** A self-volunteer's explicit text may trigger a warning, never overlap consent.
 * Restrict this path to the source that created their own pending assignment. */
export async function warnSelfVolunteerOverlap(ctx: MutationCtx, proposalId: Id<"proposals">, sourceMessageId: Id<"inboundMessages">): Promise<void> {
  const proposal = await ctx.db.get(proposalId);
  if (!proposal || proposal.type !== "assignment" || !proposal.targetUserId || proposal.targetUserId !== proposal.originatorId) throw new Error("INVALID_SELF_OFFER");
  const task = await currentReplyTask(ctx, proposal);
  if (!task) throw new Error("INVALID_SELF_OFFER");
  const { text } = await evidence(ctx, proposal.targetUserId, sourceMessageId);
  if (!explicitSelfAcceptance(text, task.title) && !explicitSelfAcceptance(text, task._id)) throw new Error("SELF_ACCEPTANCE_REQUIRED");
  const creation = await ctx.db.query("auditEvents").withIndex("by_source", q => q.eq("sourceId", `proposal-create:${proposal.originatorId}:${proposal.idempotencyKey}`)).unique();
  const saved = creation?.newStateRef ? JSON.parse(creation.newStateRef) as { input?: { sourceMessageId?: string } } : undefined;
  if (saved?.input?.sourceMessageId !== sourceMessageId) throw new Error("INVALID_SELF_OFFER");
  const event = (await ctx.db.get(proposal.eventId))!;
  if (!await eligible(ctx, event, task, proposal.targetUserId, false, true)) throw new Error("INELIGIBLE_SELF_COMMITMENT");
  const state = await captureOverlap(ctx, event, task, proposal.targetUserId);
  if (!state.conflicts.length) throw new Error("OVERLAP_NOT_FOUND");
  await warnOverlap(ctx, proposal, event, task, sourceMessageId, state);
}
export async function respondProposal(ctx: MutationCtx, args: ResponseArgs): Promise<Doc<"proposals">["state"]> {
  const { text, message } = await evidence(ctx, args.actorId, args.sourceMessageId);
  const command = parseCommand(text);
  const explicitConfirmation = args.response === "accept" && command.type === "CONFIRM_OVERLAP";
  if (!explicitConfirmation && command.type !== (args.response === "accept" ? "YES" : "NO")) throw new Error("INVALID_RESPONSE_EVIDENCE");
  const p = await ctx.db.get(args.proposalId);
  if (!p || p.targetUserId !== args.actorId) throw new Error("UNAUTHORIZED");
  await memberFor(ctx, args.actorId, p.eventId);
  const source = `proposal-response:${args.sourceMessageId}`;
  const prior = await priorRequest<Doc<"proposals">["state"]>(ctx, source, args); if (prior) return prior;
  if (message.receivedAt < Math.floor(p._creationTime)) throw new Error("RESPONSE_PREDATES_PROPOSAL");
  if ((command.type === "YES" || command.type === "NO" || command.type === "CONFIRM_OVERLAP") && command.proposalRef) {
    const match = await resolveProposalReplyReference(ctx, args.actorId, command.proposalRef);
    const exactClosedReference = command.proposalRef.toLowerCase() === p._id.toLowerCase() && !await currentReplyTask(ctx, p);
    if (match !== p._id && !exactClosedReference) throw new Error("INVALID_RESPONSE_REFERENCE");
  }
  const result = await applyResponse(ctx, args, p, explicitConfirmation, message.receivedAt);
  await audit(ctx, p.eventId, args.actorId, "proposal_response_recorded", source, { input: args, result });
  return result;
}
async function applyResponse(ctx: MutationCtx, args: ResponseArgs, p: Doc<"proposals">, explicitConfirmation: boolean, receivedAt: number): Promise<Doc<"proposals">["state"]> {
  if (p.state !== "pending") return p.state;
  if (p.requiresOrganizerApproval && p.organizerApprovedAt === undefined) throw new Error("ORGANIZER_APPROVAL_REQUIRED");
  const event = (await ctx.db.get(p.eventId))!, task = p.targetTaskId ? await ctx.db.get(p.targetTaskId) : null;
  if (p.expiresAt <= Date.now() || event.status !== "scheduled" || event.version !== p.eventVersionAtCreation || !task || task.eventId !== p.eventId || task.version !== p.taskVersionAtCreation) {
    await closeProposal(ctx, p, "expired", "This offer expired or its details changed. Ask for a new offer.", args.actorId, args.sourceMessageId); return "expired";
  }
  if (args.response === "decline") {
    await closeProposal(ctx, p, "declined", "The participant declined. Existing commitments are unchanged.", args.actorId, args.sourceMessageId);
    if (p.type === "task_change") for (const q of await group(ctx, p)) if (q._id !== p._id) await closeProposal(ctx, q, "canceled", "The proposed change did not receive every participant's approval.");
    return "declined";
  }
  const effectiveTask = p.type === "task_change" ? changedTask(task, p.taskChangeJson) : task;
  if (!await eligible(ctx, event, effectiveTask, args.actorId, p.type === "task_change", true)) { await closeProposal(ctx, p, "canceled", "The participant is no longer eligible for these details.", args.actorId, args.sourceMessageId); return "canceled"; }
  if (!await checkOverlapConsent(ctx, p, event, effectiveTask, args, explicitConfirmation, receivedAt)) return "pending";
  const active = (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", task._id)).collect()).filter(c => c.state === "active");
  if (p.type === "task_change") {
    const siblings = await group(ctx, p);
    if (siblings.some(q => q._id !== p._id && (q.state !== "accepted" && q.state !== "pending" || q.expiresAt <= Date.now()))) { await closeProposal(ctx, p, "canceled", "The proposed change is no longer valid."); return "canceled"; }
    await ctx.db.patch(p._id, { state: "accepted" });
    await audit(ctx, p.eventId, args.actorId, "task_change_approved", `proposal:${p._id}:accepted`, { sourceMessageId: args.sourceMessageId });
    const needed = active.length ? active.map(c => c.participantId) : [p.originatorId];
    if (!needed.every(id => siblings.some(q => q.targetUserId === id && (q._id === p._id || q.state === "accepted")))) {
      await notify(ctx, args.actorId, p.eventId, `Your approval for ${task.title} is recorded. Current details remain unchanged while other approvals are pending.`, `proposal:${p._id}:approved:${args.sourceMessageId}:${args.actorId}`, p._id, args.sourceMessageId); return "accepted";
    }
    const action = ProposeTaskChangeActionSchema.parse(JSON.parse(p.taskChangeJson!));
    const changes = action.field === "location" ? { location: action.newValue } : { windowStart: Date.parse(action.newValue.startsAt), windowEnd: Date.parse(action.newValue.endsAt) };
    const proposedTask = { ...task, ...changes };
    let renewedConsentNeeded = false;
    for (const id of needed) {
      if (!await eligible(ctx, event, proposedTask, id, true, true)) throw new Error("CHANGE_CONFLICT");
      if (id === args.actorId) continue;
      const sibling = siblings.find(q => q.targetUserId === id && q.state === "accepted")!;
      const state = await captureOverlap(ctx, event, proposedTask, id), warning = readWarning(sibling);
      if ((state.conflicts.length && !warning?.confirmedByMessageId) || (warning?.confirmedByMessageId && canonicalJson(warning.snapshot) !== canonicalJson(state.snapshot))) {
        await warnOverlap(ctx, sibling, event, proposedTask, args.sourceMessageId, state); renewedConsentNeeded = true;
      }
    }
    if (renewedConsentNeeded) {
      await notify(ctx, args.actorId, p.eventId, `Your approval for ${task.title} is recorded. Current details remain unchanged while other approvals are renewed.`, `proposal:${p._id}:approved:${args.sourceMessageId}:${args.actorId}`, p._id, args.sourceMessageId);
      return "accepted";
    }
    const downstream = (await ctx.db.query("tasks").withIndex("by_event", q => q.eq("eventId", event._id)).collect()).filter(t => t.status !== "canceled" && t.dependsOnTaskIds?.includes(task._id));
    if (downstream.some(t => t.windowStart === undefined || proposedTask.windowEnd === undefined || proposedTask.windowEnd > t.windowStart)) throw new Error("CHANGE_DEPENDENCY_CONFLICT");
    await ctx.db.patch(task._id, { ...changes, version: task.version + 1 });
    await audit(ctx, p.eventId, args.actorId, "task_change_committed", `task-change:${siblings.map(q => q._id).sort().join(":")}`, { taskId: task._id, version: task.version + 1 });
    for (const id of new Set([...needed, ...(await organizers(ctx, p.eventId)).map(m => m.userId)])) await notify(ctx, id, p.eventId, `${event.title}: Everyone accepted the change to ${task.title}. ${changeLabel(p.taskChangeJson!)}. The task details are updated.`, `task-change:${p._id}:committed:${id}`, p._id, id === args.actorId ? args.sourceMessageId : undefined);
  } else {
    const previous = p.type === "reassignment" ? active.find(c => c.participantId === p.subjectId) : undefined;
    if (p.type === "reassignment" && !previous || active.length - Number(!!previous) >= task.capacity) { await closeProposal(ctx, p, "superseded", "Another acceptance filled this slot.", args.actorId, args.sourceMessageId); return "superseded"; }
    if (previous) await ctx.db.patch(previous._id, { state: "released", endedAt: Date.now(), endedByActorId: args.actorId });
    await ctx.db.insert("commitments", { eventId: p.eventId, taskId: task._id, participantId: args.actorId, state: "active", sourceProposalId: p._id, sourceMessageId: args.sourceMessageId, createdAt: Date.now() });
    await ctx.db.patch(p._id, { state: "accepted" });
    const count = active.length + 1 - Number(!!previous);
    await ctx.db.patch(task._id, { status: count >= task.capacity ? "confirmed" : "needs_coverage", version: task.version + 1 });
    await audit(ctx, p.eventId, args.actorId, "assignment_committed", `proposal:${p._id}:accepted`, { taskId: task._id, sourceMessageId: args.sourceMessageId, releasedCommitmentId: previous?._id }, "pending");
    const target = (await ctx.db.get(args.actorId))!;
    const recipients = new Set([args.actorId, ...(previous ? [previous.participantId] : []), ...(await organizers(ctx, p.eventId)).map(m => m.userId)]);
    for (const id of recipients) await notify(ctx, id, p.eventId, `${event.title}: ${target.displayName} accepted ${task.title}, ${windowLabel(task, event)}. I've updated the assignment.${previous?.participantId === id ? " Your previous commitment is released." : ""}`, `proposal:${p._id}:accepted:${id}`, p._id, id === args.actorId ? args.sourceMessageId : undefined);
  }
  if (p.type !== "task_change") await advanceCompatibleOffers(ctx, task, p._id);
  else {
    const competing = (await ctx.db.query("proposals").withIndex("by_event", q => q.eq("eventId", p.eventId)).collect()).filter(q => q._id !== p._id && q.targetTaskId === task._id && q.state === "pending" && q.taskVersionAtCreation === task.version);
    for (const proposal of competing) await closeProposal(ctx, proposal, "superseded", "The task details changed. Ask for a new offer.");
  }
  return "accepted";
}
