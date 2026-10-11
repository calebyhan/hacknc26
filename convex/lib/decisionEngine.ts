import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { AgentDecisionSchema } from "../../packages/shared/agentDecision";
import { TimestampSchema } from "../../packages/shared/primitives";
import { memberFor } from "./auth";
import { audit, canonicalJson, createEvent, createTask, detailFor, eligible, evidence, notify, notifyOrganizers, priorRequest } from "./domain";
import { advanceCompatibleOffers, createProposal, explicitSelfAcceptance, warnSelfVolunteerOverlap } from "./proposalEngine";
import { reportUnavailable } from "./commitmentEngine";
import { internal } from "../_generated/api";
import { onboardingCopy } from "../../packages/shared/copy";
import { hashCode, invitationCode } from "./messaging";
import { renderStatusDetails } from "./statusText";
import { routeTaskClarification } from "./taskClarification";
import { taskInstruction } from "./taskInstructions";
import { hasNewerSetupReply } from "./conversationReplies";
import { classifyTaskStaffingIntent } from "../../packages/shared/taskIntent";

export interface DecisionResult { proposalIds: Id<"proposals">[]; commitmentIds: Id<"commitments">[]; needsClarification: boolean }
export async function executeDecision(ctx: MutationCtx, jobId: Id<"reasoningJobs">, decisionJson: string): Promise<DecisionResult> {
  if (decisionJson.length > 20000) throw new Error("DECISION_TOO_LARGE");
  const decision = AgentDecisionSchema.parse(JSON.parse(decisionJson));
  const job = await ctx.db.get(jobId); if (!job) throw new Error("UNAUTHORIZED");
  const message = await ctx.db.get(job.messageId);
  if (!message) throw new Error("UNAUTHORIZED");
  const sender = await ctx.db.query("users").withIndex("by_phone", q => q.eq("verifiedPhoneE164", message.senderPhone)).unique();
  if (!sender || sender.messagingState !== "active") throw new Error("UNAUTHORIZED");
  await evidence(ctx, sender._id, message._id);
  if (decision.eventCandidateId !== job.eventId || message.eventId && message.eventId !== job.eventId) throw new Error("DECISION_SCOPE_VIOLATION");
  const actor = job.eventId ? await memberFor(ctx, sender._id, job.eventId) : null;
  if (job.executionResultJson) {
    if (job.executedDecisionJson !== canonicalJson(decision)) throw new Error("IDEMPOTENCY_CONFLICT");
    return JSON.parse(job.executionResultJson) as DecisionResult;
  }
  const prior = await priorRequest<DecisionResult>(ctx, `job:${jobId}:executed`, decision); if (prior) return prior;
  if (job.status !== "claimed" || !job.leaseOwner || !job.leaseToken || !job.leaseUntil || job.leaseUntil <= Date.now()) throw new Error("JOB_LEASE_EXPIRED");
  if (decision.confidenceClass === "unsupported" && decision.actions.some(a => a.type !== "NO_ACTION" && a.type !== "ASK_CLARIFICATION")) throw new Error("UNSUPPORTED_ACTION");
  const instruction = await taskInstruction(ctx, message, sender);
  const { text } = instruction;
  const result: DecisionResult = { proposalIds: [], commitmentIds: [], needsClarification: decision.needsClarification };
  let auditEventId = job.eventId;
  const event = job.eventId ? await ctx.db.get(job.eventId) : null;
  if (event && (event.status === "canceled" || event.status === "completed" || event.version !== job.contextVersion)) throw new Error("STALE_EVENT");
  if (!event && (job.contextVersion !== null || job.taskVersions.length || decision.actions.some(a => !["CREATE_EVENT_DRAFT", "ASK_CLARIFICATION", "NO_ACTION"].includes(a.type)))) throw new Error("UNSCOPED_ACTION");
  if (decision.actions.filter(a => a.type === "CREATE_EVENT_DRAFT").length > 1 || event && decision.actions.some(a => a.type === "CREATE_EVENT_DRAFT")) throw new Error("INVALID_DRAFT_SCOPE");
  // A delayed question about earlier fragments must not interrupt a newer
  // guided setup. Cache a harmless completion so retry cannot resurrect it.
  if (decision.actions.every(action => action.type === "ASK_CLARIFICATION" || action.type === "NO_ACTION") && await hasNewerSetupReply(ctx, sender._id, message)) {
    result.needsClarification = false;
    if (event) await audit(ctx, event._id, sender._id, "decision_executed", `job:${jobId}:executed`, { input: decision, result, supersededQuestion: true });
    await ctx.db.patch(job._id, { executedDecisionJson: canonicalJson(decision), executionResultJson: JSON.stringify(result) });
    return result;
  }
  const clarification = await routeTaskClarification(ctx, message._id, decision.actions.some(action => ["PROPOSE_ASSIGNMENT", "PROPOSE_REASSIGNMENT", "PROPOSE_TASK_CHANGE", "RECORD_SELF_COMMITMENT", "REPORT_UNAVAILABILITY"].includes(action.type)));
  if (clarification) {
    result.needsClarification = true;
    await notify(ctx, sender._id, clarification.eventId, clarification.content, `job:${jobId}:clarify`, undefined, message._id);
    await audit(ctx, clarification.eventId, sender._id, "decision_executed", `job:${jobId}:executed`, { input: decision, result });
    await ctx.db.patch(job._id, { executedDecisionJson: canonicalJson(decision), executionResultJson: JSON.stringify(result) });
    return result;
  }
  const tasks = event ? await ctx.db.query("tasks").withIndex("by_event", q => q.eq("eventId", event._id)).collect() : [];
  const members = event ? await ctx.db.query("memberships").withIndex("by_event", q => q.eq("eventId", event._id)).collect() : [];
  const people = await Promise.all(members.filter(m => m.state === "enrolled").map(m => ctx.db.get(m.userId)));
  const resolvePerson = (ref: string) => {
    const matches = people.filter(p => p && (p._id === ref || p.displayName.toLowerCase() === ref.toLowerCase()));
    if (matches.length !== 1) throw new Error("UNRESOLVED_PARTICIPANT"); return matches[0]!;
  };
  const resolveTask = (ref: string) => {
    const matches = tasks.filter(t => t._id === ref || t.title.toLowerCase() === ref.toLowerCase());
    if (matches.length !== 1) throw new Error("UNRESOLVED_TASK");
    const task = matches[0]!;
    if (instruction.selectedTaskId && task._id !== instruction.selectedTaskId) throw new Error("CLARIFIED_TASK_SCOPE_VIOLATION");
    const snapshots = job.taskVersions.filter(v => v.taskId === task._id);
    if (snapshots.length !== 1 || snapshots[0]!.version !== task.version) throw new Error("STALE_TASK");
    return task;
  };
  // A bare task-choice reply scopes the original request to exactly one task.
  if (instruction.selectedTaskId && decision.actions.some(action => action.type === "REPORT_UNAVAILABILITY" && !action.taskRef)) throw new Error("CLARIFIED_TASK_SCOPE_VIOLATION");
  // Validate every referenced existing task before any action changes versions.
  for (const action of decision.actions) {
    if ("taskRef" in action && action.taskRef) {
      const ref = action.taskRef;
      const existing = tasks.some(t => t._id === ref || t.title.toLowerCase() === ref.toLowerCase());
      if (instruction.selectedTaskId || existing || action.type !== "RECORD_SELF_COMMITMENT") resolveTask(ref);
    }
  }
  // The model cannot turn a clear request for an extra teammate into removing
  // an existing assignee. Check the whole plan before any action can write.
  if (event && classifyTaskStaffingIntent(text) === "add" && decision.actions.some(action => action.type === "PROPOSE_REASSIGNMENT" || action.type === "REPORT_UNAVAILABILITY")) {
    result.needsClarification = true;
    await notify(ctx, sender._id, event._id, `${event.title}: You asked to add a teammate. Everyone's current assignment stays in place. Please name the task and person to add; replacing someone needs a separate explicit request.`, `job:${jobId}:staffing-clarify`, undefined, message._id);
    await audit(ctx, event._id, sender._id, "decision_executed", `job:${jobId}:executed`, { input: decision, result, rejectedReplacement: true });
    await ctx.db.patch(job._id, { executedDecisionJson: canonicalJson(decision), executionResultJson: JSON.stringify(result) });
    return result;
  }
  for (const [index, action] of decision.actions.entries()) {
    const key = `job:${jobId}:${index}`;
    if (action.type === "CREATE_EVENT_DRAFT") {
      auditEventId = await createEvent(ctx, sender._id, { title: action.title, kind: "event", startsAt: Date.parse(action.startsAt), timezone: action.timezone, ...(action.location ? { location: action.location } : {}), idempotencyKey: key });
      continue;
    }
    if (action.type === "ASK_CLARIFICATION" || action.type === "NO_ACTION") {
      result.needsClarification ||= action.type === "ASK_CLARIFICATION";
      if (event) await notify(ctx, sender._id, event._id, action.type === "ASK_CLARIFICATION" ? `For ${event.title}, name the task (${tasks.slice(0, 6).map(task => task.title).join("; ") || "no tasks yet"}) and who should help (${people.filter(person => person !== null).slice(0, 8).map(person => person!.displayName).join("; ")}). Include a time if you want to change it. No state changed.` : "No changes were made from this request.", `${key}:reply`, undefined, message._id);
      else await ctx.runMutation(internal.outbox.enqueue, { recipientUserId: sender._id, content: onboardingCopy, idempotencyKey: `${key}:reply`, directReplyToMessageId: message._id });
      continue;
    }
    if (!event || !actor) throw new Error("UNSCOPED_ACTION");
    switch (action.type) {
      case "PROPOSE_ASSIGNMENT": case "PROPOSE_REASSIGNMENT": {
        const task = resolveTask(action.taskRef), target = resolvePerson(action.toParticipantRef);
        const subject = action.type === "PROPOSE_REASSIGNMENT" ? resolvePerson(action.fromParticipantRef) : undefined;
        const proposalId = await createProposal(ctx, { eventId: event._id, originatorId: sender._id, sourceMessageId: message._id, type: action.type === "PROPOSE_ASSIGNMENT" ? "assignment" : "reassignment", ...(subject ? { subjectId: subject._id } : {}), targetTaskId: task._id, targetUserId: target._id, expectedEventVersion: event.version, expectedTaskVersion: (await ctx.db.get(task._id))!.version, expiresAt: Date.now() + 600000, idempotencyKey: key });
        result.proposalIds.push(proposalId);
        const proposal = (await ctx.db.get(proposalId))!;
        if (target._id !== sender._id) await notify(ctx, sender._id, event._id, `${event.title}: Offer created for ${target.displayName} to cover ${task.title}. ${proposal.requiresOrganizerApproval && proposal.organizerApprovedAt === undefined ? "Waiting for organizer approval before asking them." : `Waiting for ${target.displayName} to accept.`} Nobody new is confirmed yet.`, `${key}:originator`, proposalId, message._id);
        break;
      }
      case "PROPOSE_TASK_CHANGE": {
        if (actor.membership.role !== "organizer") throw new Error("UNAUTHORIZED");
        const task = resolveTask(action.taskRef);
        const active = (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", task._id)).collect()).filter(c => c.state === "active");
        result.proposalIds.push(await createProposal(ctx, { eventId: event._id, originatorId: sender._id, sourceMessageId: message._id, type: "task_change", targetTaskId: task._id, targetUserId: active[0]?.participantId ?? sender._id, taskChangeJson: JSON.stringify(action), expectedEventVersion: event.version, expectedTaskVersion: (await ctx.db.get(task._id))!.version, expiresAt: Date.now() + 600000, idempotencyKey: key }));
        break;
      }
      case "REPORT_UNAVAILABILITY": {
        const participant = resolvePerson(action.participantRef), task = action.taskRef ? resolveTask(action.taskRef) : undefined;
        await reportUnavailable(ctx, { eventId: event._id, actorId: sender._id, participantId: participant._id, ...(task ? { taskId: task._id } : {}), ...(action.window ? { window: { startsAt: Date.parse(action.window.startsAt), endsAt: Date.parse(action.window.endsAt) } } : {}), sourceMessageId: instruction.sourceMessageId, expectedEventVersion: event.version });
        break;
      }
      case "RECORD_AVAILABILITY": {
        const ownStatement = action.kind === "available" ? /\b(?:I am|I'm|I will be|I'll be)\s+(?:available|free)\b/iu : /\b(?:I am|I'm|I will be|I'll be)\s+(?:unavailable|busy)\b/iu;
        if (!ownStatement.test(text)) throw new Error("SELF_AVAILABILITY_EVIDENCE_REQUIRED");
        await ctx.db.insert("availability", { eventId: event._id, userId: sender._id, windowStart: TimestampSchema.parse(Date.parse(action.window.startsAt)), windowEnd: TimestampSchema.parse(Date.parse(action.window.endsAt)), kind: action.kind, source: "self_reported", reportedByUserId: sender._id, sourceMessageId: message._id, recordedAt: Date.now() });
        await audit(ctx, event._id, sender._id, "availability_recorded", key, { kind: action.kind, sourceMessageId: message._id }); break;
      }
      case "RECORD_SELF_COMMITMENT": {
        // Interpretation may resolve the item; only the speaker's explicit own
        // offer can be acceptance. Equivocal/negative text cannot supply it.
        let task = tasks.find(t => t._id === action.taskRef || t.title.toLowerCase() === action.taskRef.toLowerCase());
        if (!(task ? explicitSelfAcceptance(text, task.title) || explicitSelfAcceptance(text, task._id) : explicitSelfAcceptance(text, action.taskRef))) throw new Error("SELF_ACCEPTANCE_REQUIRED");
        if (!task) {
          if (!action.window) throw new Error("TASK_WINDOW_REQUIRED");
          // A participant's new volunteered item is organizer-visible, not a
          // privileged edit to somebody else's task.
          const taskId = await ctx.db.insert("tasks", { eventId: event._id, title: action.taskRef, windowStart: Date.parse(action.window.startsAt), windowEnd: Date.parse(action.window.endsAt), capacity: 1, status: "unassigned", version: 1 });
          task = (await ctx.db.get(taskId))!;
        }
        const current = (await ctx.db.get(task._id))!;
        const active = (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", task!._id)).collect()).filter(c => c.state === "active");
        if (active.some(c => c.participantId === sender._id)) { result.commitmentIds.push(active.find(c => c.participantId === sender._id)!._id); break; }
        if (active.length >= current.capacity) throw new Error("INELIGIBLE_SELF_COMMITMENT");
        if (!await eligible(ctx, event, current, sender._id)) {
          // Explicit volunteering does not silently override another accepted
          // commitment. Offer first, warn from signed text, require confirmation.
          if (!await eligible(ctx, event, current, sender._id, false, true)) throw new Error("INELIGIBLE_SELF_COMMITMENT");
          const proposalId = await createProposal(ctx, { eventId: event._id, originatorId: sender._id, sourceMessageId: message._id, type: "assignment", targetTaskId: current._id, targetUserId: sender._id, expectedEventVersion: event.version, expectedTaskVersion: current.version, expiresAt: Date.now() + 600000, idempotencyKey: key });
          await warnSelfVolunteerOverlap(ctx, proposalId, message._id);
          result.proposalIds.push(proposalId);
          break;
        }
        const commitmentId = await ctx.db.insert("commitments", { eventId: event._id, taskId: task._id, participantId: sender._id, state: "active", sourceMessageId: message._id, createdAt: Date.now() });
        await ctx.db.patch(task._id, { status: active.length + 1 >= current.capacity ? "confirmed" : "needs_coverage", version: current.version + 1 });
        await advanceCompatibleOffers(ctx, current);
        await audit(ctx, event._id, sender._id, "self_commitment_recorded", key, { commitmentId, sourceMessageId: message._id });
        await notifyOrganizers(ctx, event._id, `${event.title}: ${sender.displayName} volunteered and accepted ${task.title}.`, `${key}:organizer`);
        result.commitmentIds.push(commitmentId); break;
      }
      case "ADD_INVITEE_DRAFT": {
        if (actor.membership.role !== "organizer") throw new Error("UNAUTHORIZED");
        const selected = (await ctx.db.query("contactSelections").withIndex("by_owner", q => q.eq("ownerUserId", sender._id)).collect()).filter(c => (!c.eventId || c.eventId === event._id) && (c._id === action.contactRef || c.displayName.toLowerCase() === action.contactRef.toLowerCase()));
        if (selected.length !== 1) throw new Error("UNRESOLVED_SELECTED_CONTACT");
        const contact = selected[0]!;
        const existing = await ctx.db.query("users").withIndex("by_phone", q => q.eq("verifiedPhoneE164", contact.phoneE164)).unique();
        const oldInvite = contact.invitationId ? await ctx.db.get(contact.invitationId) : null;
        const targetUserId = existing?._id ?? oldInvite?.targetUserId ?? await ctx.db.insert("users", { displayName: contact.displayName, messagingState: "active", createdAt: Date.now(), settings: {} });
        const membership = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", event._id).eq("userId", targetUserId)).unique();
        if (membership?.state === "enrolled") break;
        if (!membership) await ctx.db.insert("memberships", { eventId: event._id, userId: targetUserId, role: "member", state: "invited", notificationsEnabled: false });
        const code = await invitationCode(canonicalJson([sender._id, event._id, key, contact.phoneE164]));
        if (oldInvite?.state === "pending") await ctx.db.patch(oldInvite._id, { state: "revoked" });
        const invitationId = await ctx.db.insert("invitations", { purpose: "event_invite", eventId: event._id, inviterUserId: sender._id, contactSelectionId: contact._id, targetUserId, codeHash: await hashCode(code), state: "pending", expiresAt: Date.now() + 86400000, failedAttempts: 0 });
        await ctx.db.patch(contact._id, { eventId: event._id, invitationId });
        await audit(ctx, event._id, sender._id, "invitee_draft_added", key, { invitationId }); break;
      }
      case "REQUEST_STATUS": {
        const detail = await detailFor(ctx, sender._id, event._id);
        await notify(ctx, sender._id, event._id, renderStatusDetails([detail]), `${key}:reply`, undefined, message._id); break;
      }
    }
  }
  if (auditEventId) await audit(ctx, auditEventId, sender._id, "decision_executed", `job:${jobId}:executed`, { input: decision, result });
  await ctx.db.patch(job._id, { executedDecisionJson: canonicalJson(decision), executionResultJson: JSON.stringify(result) });
  return result;
}
