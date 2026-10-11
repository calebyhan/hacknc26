import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { readSourceContext } from "../context";
import { taskChangingText, taskChoices, taskQuestion } from "./taskInstructions";

async function setFocus(ctx: MutationCtx, userId: Id<"users">, fields: { [K in keyof Omit<Doc<"conversationFocus">, "_id" | "_creationTime" | "userId" | "updatedAt" | "expiresAt">]?: Doc<"conversationFocus">[K] | undefined }) {
  const old = await ctx.db.query("conversationFocus").withIndex("by_user", q => q.eq("userId", userId)).unique();
  const times = { updatedAt: Date.now(), expiresAt: Date.now() + 15 * 60_000 };
  if (old) await ctx.db.patch(old._id, { ...times, ...fields });
  else await ctx.db.insert("conversationFocus", { userId, ...times,
    ...(fields.lastEventId === undefined ? {} : { lastEventId: fields.lastEventId }),
    ...(fields.lastTaskId === undefined ? {} : { lastTaskId: fields.lastTaskId }),
    ...(fields.lastIntent === undefined ? {} : { lastIntent: fields.lastIntent }),
    ...(fields.pendingTaskClarification === undefined ? {} : { pendingTaskClarification: fields.pendingTaskClarification }),
  });
}

/** Also used at execution: a model-selected task cannot override ambiguity in
 * verified inbound text. Only enrolled/consented event facts enter choices. */
export async function routeTaskClarification(ctx: MutationCtx, messageId: Id<"inboundMessages">, requireTaskReference = false): Promise<{ content: string; eventId: Id<"events"> } | null> {
  const source = await readSourceContext(ctx, messageId);
  const { user, message, envelope, instruction, events, eventTasks, resolution, focus, pending } = source;
  const clarification = focus?.pendingTaskClarification;
  const explicitOtherEvent = clarification && resolution.reasonCodes.includes("EXPLICIT_EVENT") && resolution.selectedEventId !== clarification.eventId;
  if (explicitOtherEvent) await setFocus(ctx, user._id, { pendingTaskClarification: undefined });
  if (clarification && !explicitOtherEvent && !clarification.resolvedByMessageId && !message.clarifiesMessageId && message._id !== clarification.sourceMessageId) {
    const choices = clarification.taskVersions.map(snapshot => eventTasks.find(task => task._id === snapshot.taskId)).filter((task): task is Doc<"tasks"> => !!task);
    const answer = envelope.text.trim().replace(/[.!?]+$/u, "").trim();
    const index = /^\d{1,2}$/u.test(answer) ? Number(answer) - 1 : -1;
    const matches = index >= 0 ? choices[index] ? [choices[index]!] : [] : choices.filter(task => answer.toLowerCase() === task.title.toLowerCase() || answer === task._id || answer.toLowerCase() === `the ${task.title.toLowerCase()} one`);
    // A fresh full request replaces the old question; short answers can only
    // select one of its original choices, never create a guessed task.
    if (matches.length || !taskChangingText(answer) && answer.split(/\s+/u).length <= 6) {
      const event = events.find(item => item._id === clarification.eventId);
      const original = await ctx.db.get(clarification.sourceMessageId);
      if (!event || clarification.expiresAt <= Date.now() || event.version !== clarification.eventVersion || !original || original.senderPhone !== message.senderPhone || original.provider !== "spectrum" || Date.now() - original.receivedAt > 15 * 60_000 || choices.length !== clarification.taskVersions.length || clarification.taskVersions.some(snapshot => !choices.some(task => task._id === snapshot.taskId && task.version === snapshot.version && !["canceled", "completed"].includes(task.status)))) {
        await setFocus(ctx, user._id, { pendingTaskClarification: undefined });
        if (!event) return null;
        return { eventId: event._id, content: `${event.title}: that task question expired or the plan changed. Please send your full request again. No task changed.` };
      }
      if (matches.length !== 1) return { eventId: event._id, content: taskQuestion(event, choices) };
      await ctx.db.patch(message._id, { clarifiesMessageId: clarification.sourceMessageId, clarifiedTaskId: matches[0]!._id });
      await setFocus(ctx, user._id, { lastEventId: event._id, lastTaskId: matches[0]!._id, pendingTaskClarification: { ...clarification, resolvedByMessageId: message._id } });
      return null;
    }
    await setFocus(ctx, user._id, { pendingTaskClarification: undefined });
  }
  const event = events.find(item => item._id === resolution.selectedEventId);
  if (!event) return null;
  if (instruction.selectedTaskId) return null;
  const tasks = eventTasks.filter(task => task.eventId === event._id);
  const commitments = (await ctx.db.query("commitments").withIndex("by_event", q => q.eq("eventId", event._id)).collect()).filter(commitment => commitment.participantId === user._id && commitment.state === "active");
  const personalIds = new Set([...commitments.map(commitment => commitment.taskId), ...pending.filter(offer => offer.eventId === event._id && offer.targetTaskId).map(offer => offer.targetTaskId!)]);
  const choices = taskChoices(instruction.text, tasks, personalIds);
  if ((requireTaskReference || taskChangingText(instruction.text)) && choices.length > 1) {
    const displayed = choices.slice(0, 10);
    await setFocus(ctx, user._id, { lastEventId: event._id, pendingTaskClarification: { eventId: event._id, sourceMessageId: message._id, eventVersion: event.version, taskVersions: displayed.map(task => ({ taskId: task._id, version: task.version })), expiresAt: Math.min(Date.now() + 5 * 60_000, message.receivedAt + 15 * 60_000) } });
    return { eventId: event._id, content: taskQuestion(event, displayed) };
  }
  await setFocus(ctx, user._id, { lastEventId: event._id, ...(choices.length === 1 && taskChangingText(instruction.text) ? { lastTaskId: choices[0]!._id } : {}) });
  return null;
}
