import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { WizardStateSchema, SETUP_TTL_MS, parseWizardStart, parseTimezone, parseFriendlyInstant, formatLocalDate, normalizeSelectedPhone, friendlyDateHelp, normalizeSetupConfirmation, reviewedCreateConfirmation, taskContinuationInput, type WizardState } from "../../packages/shared/phoneConversation";
import { parsePhoneSetupCommand } from "../../packages/shared/phoneSetup";
import { audit, createEvent, createTask } from "./domain";
import { contentDigest } from "./messaging";
import { createContactInvitations } from "./invitations";
import { approveProposal, approvalReferenceMatches, getApprovalOptions } from "./proposalEngine";
import { invalidJoinCopy } from "../../packages/shared/copy";
import { parseCommand } from "../../packages/shared/commands";

const restartCopy = 'Text "create an event", "invite someone", or "add a task" to begin again.';
const finalPhrases = new Set(["yes, create it", "yes, add it", "yes, invite them"]);
const validTitle = (text: string) => text.length >= 1 && text.length <= 120 && !/[\r\n|]/u.test(text);

/** Hash-bound direct replies also work before any event exists. Neither raw
 * inbound text nor selected phone numbers are copied into this receipt. */
async function reply(ctx: MutationCtx, user: Doc<"users">, message: Doc<"inboundMessages">, content: string) {
  const prior = await ctx.db.query("phoneSetupReceipts").withIndex("by_message", q => q.eq("messageId", message._id)).unique();
  const contentHash = await contentDigest(content);
  if (prior) {
    if (prior.userId !== user._id || prior.contentHash !== contentHash) throw new Error("IDEMPOTENCY_CONFLICT");
  } else await ctx.db.insert("phoneSetupReceipts", { userId: user._id, messageId: message._id, contentHash, createdAt: Date.now() });
  await ctx.runMutation(internal.outbox.enqueue, { recipientUserId: user._id, directReplyToMessageId: message._id, idempotencyKey: `inbound:${message._id}:guided-setup`, content });
}

async function focus(ctx: MutationCtx, userId: Id<"users">, eventId: Id<"events">) {
  const old = await ctx.db.query("conversationFocus").withIndex("by_user", q => q.eq("userId", userId)).unique();
  const fields = { userId, lastEventId: eventId, lastIntent: "phone_setup", updatedAt: Date.now(), expiresAt: Date.now() + SETUP_TTL_MS };
  if (old) await ctx.db.replace(old._id, fields); else await ctx.db.insert("conversationFocus", fields);
}

async function ownedEvents(ctx: MutationCtx, user: Doc<"users">) {
  const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", user._id)).collect();
  const events: Doc<"events">[] = [];
  for (const membership of memberships) {
    if (membership.state !== "enrolled" || membership.role !== "organizer" || membership.consentAt === undefined || !membership.consentSourceMessageId) continue;
    const [event, proof] = await Promise.all([ctx.db.get(membership.eventId), ctx.db.get(membership.consentSourceMessageId)]);
    if (event?.status === "scheduled" && proof?.provider === "spectrum" && proof.senderPhone === user.verifiedPhoneE164) events.push(event);
  }
  return events;
}

function eventPrompt(events: Doc<"events">[]) {
  return "Which event? Reply with its number or exact name:\n" + events.map((event, index) => `${index + 1}. ${event.title} — ${formatLocalDate(event.startsAt, event.timezone)}`).join("\n");
}

function afterScope(state: WizardState, event: Doc<"events">) {
  const next: WizardState = { flow: state.flow, step: state.flow === "invite" ? "name" : "title", eventId: event._id, expectedVersion: event.version, timezone: event.timezone, startsAt: event.startsAt };
  return { next, text: state.flow === "invite" ? `For ${event.title}, who would you like to invite? Send their name. I won't message them automatically.` : `For ${event.title}, what's the task called? Tasks can overlap; each can need more than one person.` };
}

function preview(state: WizardState, event?: Doc<"events">): string {
  if (state.flow === "event") return `Review your event:\n${state.title}\n${formatLocalDate(state.startsAt!, state.timezone!)}\n${state.location ?? "No location set"}\n\nReply "yes, create it" to schedule this event and opt in to Rally's iMessage updates for this event. You can STOP at any time. No one else is invited or assigned. Reply "cancel setup" to discard it.`;
  if (state.flow === "invite") return `Invite ${state.displayName} to ${event!.title}? Selected phone ends in ${state.phoneE164!.slice(-4)}.\nReply "yes, invite them" to create an invitation for you to share. I won't message or enroll them. Reply "cancel setup" to discard it.`;
  return `Review ${state.title} for ${event!.title}:\n${formatLocalDate(state.windowStart!, event!.timezone)} to ${formatLocalDate(state.windowEnd!, event!.timezone)}\nNeeds ${state.capacity} ${state.capacity === 1 ? "person" : "people"}. No one is assigned yet.\nReply "yes, add it" to save, or "cancel setup" to discard it.`;
}

/** Named JOIN is safe only for one selected phone-bound pending invitation.
 * A name never supplies sender identity and no invitation is created here. */
async function namedJoin(ctx: MutationCtx, user: Doc<"users">, message: Doc<"inboundMessages">, text: string): Promise<boolean> {
  const match = /^join\s+(.+)$/iu.exec(text.trim());
  if (!match || /^[a-f0-9]{32}$/iu.test(match[1]!)) return false;
  const exactRef = match[1]!.trim().toLowerCase(), ref = exactRef.replace(/[.!?]+$/u, "");
  const selections = await ctx.db.query("contactSelections").withIndex("by_phone", q => q.eq("phoneE164", message.senderPhone)).collect();
  const matches: { invitation: Doc<"invitations">; event: Doc<"events">; target: Doc<"users">; membership: Doc<"memberships"> }[] = [];
  for (const selected of selections) {
    if (selected.phoneE164 !== message.senderPhone || !selected.invitationId) continue;
    const invitation = await ctx.db.get(selected.invitationId);
    if (!invitation || invitation.purpose !== "event_invite" || invitation.state !== "pending" || invitation.expiresAt <= Date.now() || invitation.failedAttempts >= 5 || !invitation.eventId || !invitation.targetUserId) continue;
    if (invitation.contactSelectionId !== selected._id || invitation.eventId !== selected.eventId || invitation.inviterUserId !== selected.ownerUserId || message.receivedAt < selected.selectedAt || message.receivedAt < Math.floor(invitation._creationTime) || message.receivedAt > invitation.expiresAt) continue;
    const inviter = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", invitation.eventId!).eq("userId", invitation.inviterUserId)).unique();
    if (inviter?.state !== "enrolled" || inviter.role !== "organizer") continue;
    const event = await ctx.db.get(invitation.eventId), target = await ctx.db.get(invitation.targetUserId);
    if (!event || !target || ["completed", "canceled"].includes(event.status) || ![exactRef, ref].some(reference => event.title.toLowerCase() === reference || event._id.toLowerCase() === reference)) continue;
    if (target._id !== user._id && (target.authSubject || target.verifiedPhoneE164)) continue;
    const membership = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", event._id).eq("userId", target._id)).unique();
    if (!membership || membership.state === "enrolled" && (membership.role !== "organizer" || membership.consentAt !== undefined || invitation.inviterUserId !== target._id || target._id !== user._id)) continue;
    matches.push({ invitation, event, target, membership });
  }
  const exactMatches = matches.filter(item => item.event.title.toLowerCase() === exactRef || item.event._id.toLowerCase() === exactRef);
  const candidates = exactMatches.length ? exactMatches : matches;
  if (candidates.length !== 1) {
    await reply(ctx, user, message, candidates.length > 1 ? "More than one invitation matches. Ask the organizer to share the original invitation code for the right event." : invalidJoinCopy);
    return true;
  }
  const { invitation, event, target, membership } = candidates[0]!;
  const duplicate = target._id !== user._id ? await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", event._id).eq("userId", user._id)).unique() : null;
  const updates = { userId: user._id, state: "enrolled" as const, notificationsEnabled: true, joinedAt: Date.now(), consentAt: Date.now(), consentSourceMessageId: message._id };
  if (duplicate) { await ctx.db.delete(membership._id); await ctx.db.patch(duplicate._id, updates); }
  else await ctx.db.patch(membership._id, updates);
  if (user.displayName === "Rally participant") await ctx.db.patch(user._id, { displayName: target.displayName });
  await ctx.db.patch(invitation._id, { targetUserId: user._id, state: "redeemed", redeemedByPhoneE164: message.senderPhone, redeemedAt: Date.now() });
  await audit(ctx, event._id, user._id, "named_invitation_join", `phone-consent:${message._id}`, { invitationId: invitation._id, sourceMessageId: message._id });
  await focus(ctx, user._id, event._id);
  await reply(ctx, user, message, `You've joined ${event.title} and opted in to its Rally updates. Text STATUS for assignments or STOP to stop messages.`);
  return true;
}

async function namedApproval(ctx: MutationCtx, user: Doc<"users">, message: Doc<"inboundMessages">, text: string): Promise<boolean> {
  const match = /^approve\s+(.+)$/iu.exec(text.trim());
  if (!match) return false;
  const exactRef = match[1]!.trim(), ref = exactRef.replace(/[.!?]+$/u, "");
  if (ctx.db.normalizeId("proposals", ref)) return false; // Preserve expert ID form.
  const options = await getApprovalOptions(ctx, user._id);
  const exactMatches = options.filter(option => approvalReferenceMatches(exactRef, option));
  const matches = options.filter(option => approvalReferenceMatches(ref, option));
  const choices = options.map(option => `${option.task.title} for ${option.target.displayName} at ${option.event.title}: approve ${option.reference}`);
  const candidates = exactMatches.length ? exactMatches : matches;
  if (candidates.length !== 1) {
    await reply(ctx, user, message, choices.length ? `Choose one current organizer request:\n${choices.slice(0, 10).join("\n")}\nApproval only permits asking them; they still need to accept.` : "You have no current organizer approval matching that request. No assignment changed.");
    return true;
  }
  const { proposal } = candidates[0]!;
  await approveProposal(ctx, proposal._id, user._id, message._id);
  // Their own participant request is the actionable acknowledgement. Avoid a
  // second generic receipt that could obscure the YES / NO question.
  if (proposal.targetUserId !== user._id) {
    const target = await ctx.db.get(proposal.targetUserId!), task = await ctx.db.get(proposal.targetTaskId!);
    await reply(ctx, user, message, `Organizer approval recorded. Waiting for ${target!.displayName} to accept ${task!.title}; no assignment is confirmed.`);
  }
  return true;
}

export async function handlePhoneConversation(ctx: MutationCtx, user: Doc<"users">, message: Doc<"inboundMessages">, text: string): Promise<boolean> {
  if (user.messagingState !== "active") return false;
  if (await namedJoin(ctx, user, message, text)) return true;
  if (await namedApproval(ctx, user, message, text)) return true;
  let start = parseWizardStart(text);
  const input = text.trim(), normalized = normalizeSetupConfirmation(input);
  // Existing expert commands keep their original parser and semantics.
  if (!start && parsePhoneSetupCommand(text)) return false;
  if (!start && !finalPhrases.has(normalized) && parseCommand(text).type !== "UNKNOWN") return false;
  const session = await ctx.db.query("phoneSetupSessions").withIndex("by_user", q => q.eq("userId", user._id)).unique();
  if (!start && !session) {
    if (finalPhrases.has(normalized)) { await reply(ctx, user, message, "There's no reviewed setup waiting for confirmation. " + restartCopy); return true; }
    return false;
  }
  if (session?.lastMessageId === message._id) return true;
  if (session) {
    const previous = await ctx.db.get(session.lastMessageId);
    // A delayed earlier input cannot become a field in a newer conversation.
    if (previous && (message.receivedAt < previous.receivedAt || message.receivedAt === previous.receivedAt && message._creationTime < previous._creationTime)) return true;
  }
  if (session && session.expiresAt <= Date.now() && !start) {
    await ctx.db.delete(session._id); await reply(ctx, user, message, "That setup expired after 15 minutes without a reply. Saved tasks are unchanged; no unfinished item was created. " + restartCopy); return true;
  }
  if (["cancel", "cancel setup"].includes(normalized)) {
    if (session) await ctx.db.delete(session._id);
    await reply(ctx, user, message, "Setup canceled. Saved tasks are unchanged; no unfinished item was created. " + restartCopy); return true;
  }
  const parsed = session ? WizardStateSchema.safeParse(JSON.parse(session.stateJson)) : null;
  if (!start && !parsed?.success) {
    if (session) await ctx.db.delete(session._id);
    await reply(ctx, user, message, "I couldn't restore that setup. " + restartCopy); return true;
  }
  if (!start && ["reset", "start over"].includes(normalized)) start = parsed!.data!.flow;
  let state: WizardState = start ? { flow: start, step: start === "event" ? "title" : "event" } : parsed!.data!;
  const save = async (next: WizardState, content: string) => {
    const values = { userId: user._id, stateJson: JSON.stringify(WizardStateSchema.parse(next)), expiresAt: Date.now() + SETUP_TTL_MS, updatedAt: Date.now(), lastMessageId: message._id };
    if (session) await ctx.db.replace(session._id, values); else await ctx.db.insert("phoneSetupSessions", values);
    await reply(ctx, user, message, content);
  };
  const error = (content: string) => save(state, content);
  if (!start && state.flow === "task" && normalized === "done") {
    await ctx.db.delete(session!._id);
    await reply(ctx, user, message, 'Task setup finished. Saved tasks are unchanged; any unfinished task was discarded. Text "add a task" whenever you want to add another.'); return true;
  }
  if (!start && state.step === "next_task") {
    if (finalPhrases.has(normalized)) { await error("The last task is already saved. Send the next task's name, or reply 'done'."); return true; }
    const kind = taskContinuationInput(input);
    if (kind === "conversation") { await ctx.db.delete(session!._id); return false; }
    if (kind === "invalid") { await error("Send the next task's name first, or reply 'done'. To restart, text 'add a task'."); return true; }
    state.step = "title";
  }
  if (!start && state.step === "title") {
    if (finalPhrases.has(normalized)) { await error("There's no reviewed setup waiting for confirmation. " + restartCopy); return true; }
    if (state.flow === "task" && taskContinuationInput(input) === "conversation") { await ctx.db.delete(session!._id); return false; }
  }
  if (start === "event") {
    const timezone = user.settings.timezone && parseTimezone(user.settings.timezone);
    if (timezone) state.timezone = timezone;
    await save(state, "Let's plan it. What's the event called? You can reply 'cancel setup' at any time."); return true;
  }
  if (start === "invite" || start === "task") {
    const events = await ownedEvents(ctx, user);
    if (!events.length) { if (session) await ctx.db.delete(session._id); await reply(ctx, user, message, 'You need a scheduled event with your own messaging opt-in first. Text "create an event" to set one up.'); return true; }
    const currentFocus = await ctx.db.query("conversationFocus").withIndex("by_user", q => q.eq("userId", user._id)).unique();
    const focused = currentFocus && currentFocus.expiresAt > Date.now() ? events.find(event => event._id === currentFocus.lastEventId) : null;
    const selected = focused ?? (events.length === 1 ? events[0] : null);
    if (selected) { const next = afterScope(state, selected); await save(next.next, next.text); }
    else { state.eventChoices = events.slice(0, 20).map(event => event._id); await save(state, eventPrompt(events.slice(0, 20))); }
    return true;
  }
  const events = state.flow !== "event" ? await ownedEvents(ctx, user) : [];
  let event = state.eventId ? events.find(event => event._id === state.eventId) : undefined;
  if (state.step === "event") {
    const choices = (state.eventChoices ?? []).map(id => events.find(event => event._id === id)).filter((item): item is Doc<"events"> => !!item);
    const selectedId = /^\d+$/u.test(input) ? state.eventChoices?.[Number(input) - 1] : undefined;
    const matches = choices.filter(event => selectedId ? event._id === selectedId : event.title.toLowerCase() === input.toLowerCase() || event._id === input);
    if (matches.length !== 1) await error("Please choose one event number or exact name.\n" + eventPrompt(choices));
    else { const next = afterScope(state, matches[0]!); await save(next.next, next.text); }
    return true;
  }
  if (state.flow !== "event" && (!event || event.version !== state.expectedVersion)) {
    if (session) await ctx.db.delete(session._id);
    await reply(ctx, user, message, "That event changed or you no longer have organizer access. Nothing was created. " + restartCopy); return true;
  }
  switch (state.step) {
    case "title":
      if (!validTitle(input)) { await error("Use a title with 1–120 characters on one line, without |."); break; }
      state.title = input;
      if (state.flow === "event") { state.step = "when"; await save(state, `When is it? ${friendlyDateHelp}${state.timezone ? ` I'll use your saved timezone: ${state.timezone}.` : " I'll ask for the timezone next."}`); }
      else { state.step = "start"; await save(state, `When does ${state.title} start? For the event day (${formatLocalDate(event!.startsAt, event!.timezone)}), send a time like 1 PM. For another day, send Oct 18, 2026 at 1 PM. Times use ${event!.timezone}.`); }
      break;
    case "when": {
      // First validate the explicit grammar without guessing the final zone.
      const parsedDate = parseFriendlyInstant(input, state.timezone ?? "UTC");
      if (parsedDate.error) { await error(parsedDate.error); break; }
      state.localTime = input;
      if (!state.timezone) { state.step = "timezone"; await save(state, "Which timezone? Reply Eastern, Central, Mountain, Pacific, UTC, or an IANA name such as Europe/London."); break; }
      if (parsedDate.timestamp! <= Date.now() || parsedDate.timestamp! > Date.now() + 366 * 86_400_000) { await error("Choose a future date within the next year. " + friendlyDateHelp); break; }
      state.startsAt = parsedDate.timestamp!; state.step = "location";
      await save(state, `Where is it? I'll use ${formatLocalDate(state.startsAt, state.timezone)}. Send a place, or 'skip'.`); break;
    }
    case "timezone": {
      const zone = parseTimezone(input);
      if (!zone) { await error("I couldn't identify that timezone. Use Eastern, Central, Mountain, Pacific, UTC, or an IANA name such as Europe/London."); break; }
      const parsedDate = parseFriendlyInstant(state.localTime!, zone);
      if (parsedDate.error || parsedDate.timestamp! <= Date.now() || parsedDate.timestamp! > Date.now() + 366 * 86_400_000) { state.timezone = zone; state.step = "when"; await save(state, parsedDate.error ?? "Choose a future date within the next year. " + friendlyDateHelp); break; }
      state.timezone = zone; state.startsAt = parsedDate.timestamp!; state.step = "location";
      await save(state, `Where is it? I'll use ${formatLocalDate(state.startsAt, zone)}. Send a place, or 'skip'.`); break;
    }
    case "location":
      if (normalized !== "skip" && !validTitle(input)) { await error("Send a location with 1–120 characters on one line, or 'skip'."); break; }
      if (normalized !== "skip") state.location = input;
      state.step = "review"; await save(state, preview(state)); break;
    case "name":
      if (!validTitle(input)) { await error("Send one person's name, using 1–120 characters on one line."); break; }
      state.displayName = input; state.step = "phone";
      await save(state, `What's ${input}'s phone, including the + country code? Formatting like +1 (555) 000-0002 is okay. I'll show only its last four digits in the review.`); break;
    case "phone": {
      const normalizedPhone = normalizeSelectedPhone(input);
      if (normalizedPhone.error) { await error(normalizedPhone.error); break; }
      state.phoneE164 = normalizedPhone.phone!; state.step = "review";
      await save(state, preview(state, event)); break;
    }
    case "start": case "end": {
      const parsedDate = parseFriendlyInstant(input, event!.timezone, state.step === "end" ? state.windowStart : event!.startsAt);
      if (parsedDate.error) { await error(parsedDate.error); break; }
      if (parsedDate.timestamp! <= Date.now()) { await error("Choose a future time, including AM or PM."); break; }
      if (state.step === "start") { state.windowStart = parsedDate.timestamp!; state.step = "end"; await save(state, "When does it end? Send a later time like 2 PM on the same day, or include the full date for a later day."); }
      else if (parsedDate.timestamp! <= state.windowStart!) await error("The end must be after the start. For an overnight task, include the next day's date and AM or PM.");
      else { state.windowEnd = parsedDate.timestamp!; state.step = "capacity"; await save(state, "How many people are needed at the same time? Reply with a number from 1 to 20. This doesn't assign anyone."); }
      break;
    }
    case "capacity":
      if (!/^\d+$/u.test(input) || Number(input) < 1 || Number(input) > 20) { await error("Reply with a whole number from 1 to 20 for staffing."); break; }
      state.capacity = Number(input); state.step = "review"; await save(state, preview(state, event)); break;
    case "review": {
      const expected = state.flow === "event" ? "yes, create it" : state.flow === "task" ? "yes, add it" : "yes, invite them";
      if (!(state.flow === "event" ? reviewedCreateConfirmation(input) : normalized === expected)) { await error(`Nothing has been created. Reply "${expected}" to confirm the reviewed details, or "cancel setup" to discard them.`); break; }
      if (state.flow === "event") {
        if (!state.title || !state.timezone || !state.startsAt || state.startsAt <= Date.now()) { await error("That event time has passed. Reply 'cancel setup' and start again."); break; }
        const eventId = await createEvent(ctx, user._id, { title: state.title, kind: "event", startsAt: state.startsAt, timezone: state.timezone, ...(state.location ? { location: state.location } : {}), idempotencyKey: `guided:${session!._id}` });
        const member = (await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", eventId).eq("userId", user._id)).unique())!;
        await ctx.db.patch(eventId, { status: "scheduled", version: 2 });
        await ctx.db.patch(member._id, { notificationsEnabled: true, consentAt: Date.now(), consentSourceMessageId: message._id });
        await audit(ctx, eventId, user._id, "guided_event_consent", `phone-consent:${message._id}`, { sourceMessageId: message._id });
        await audit(ctx, eventId, user._id, "event_confirmed", `event-confirm:${eventId}:1`, { version: 2, sourceMessageId: message._id });
        await ctx.db.patch(user._id, { settings: { ...user.settings, timezone: state.timezone } });
        await focus(ctx, user._id, eventId);
        await ctx.db.delete(session!._id);
        await reply(ctx, user, message, `${state.title} is scheduled for ${formatLocalDate(state.startsAt, state.timezone)}. Your event updates are on. Next, text "invite someone" or "add a task". No one is assigned yet.`);
      } else if (state.flow === "task") {
        if (!state.windowStart || state.windowStart <= Date.now()) { await error("That task's start time has passed. Reply 'cancel setup' and start again."); break; }
        await createTask(ctx, user._id, { eventId: event!._id, title: state.title!, windowStart: state.windowStart!, windowEnd: state.windowEnd!, capacity: state.capacity!, expectedEventVersion: state.expectedVersion!, idempotencyKey: `guided:${session!._id}` });
        await focus(ctx, user._id, event!._id); await ctx.db.delete(session!._id);
        // A new session gives each reviewed task its own creation key while
        // keeping the event scope for a short, explicit continuation window.
        const next = WizardStateSchema.parse({ ...afterScope(state, event!).next, step: "next_task" });
        await ctx.db.insert("phoneSetupSessions", { userId: user._id, stateJson: JSON.stringify(next), expiresAt: Date.now() + SETUP_TTL_MS, updatedAt: Date.now(), lastMessageId: message._id });
        await reply(ctx, user, message, `${state.title} is saved for ${event!.title}, needing ${state.capacity} ${state.capacity === 1 ? "person" : "people"}. It's unassigned. Send the next task's name, or reply 'done'.`);
      } else {
        // The full selected phone remains in protected storage, not reply text.
        await createContactInvitations(ctx, user._id, { eventId: event!._id, contacts: [{ displayName: state.displayName!, phoneE164: state.phoneE164! }], idempotencyKey: `guided:${session!._id}` });
        await focus(ctx, user._id, event!._id); await ctx.db.delete(session!._id);
        await reply(ctx, user, message, `Invitation ready for ${state.displayName}. Share this yourself: "Text join ${event!.title} in your own Rally conversation to join and receive event updates." It works only from their selected phone and expires in 24 hours. I haven't contacted or enrolled them.`);
      }
      break;
    }
  }
  return true;
}
