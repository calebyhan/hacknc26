import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { openEnvelope } from "./messaging";

export function mentionsReference(text: string, reference: string): boolean {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, "iu").test(text);
}

/** A stored clarification is authority only when both signed messages and its
 * frozen event/task selection still agree. No message text comes from a model. */
export async function taskInstruction(ctx: QueryCtx, message: Doc<"inboundMessages">, user: Doc<"users">) {
  const envelope = await openEnvelope(message);
  if (!message.clarifiesMessageId && !message.clarifiedTaskId) return { text: envelope.text, selectedTaskId: null, sourceMessageId: message._id };
  const focus = await ctx.db.query("conversationFocus").withIndex("by_user", q => q.eq("userId", user._id)).unique();
  const pending = focus?.pendingTaskClarification;
  const source = message.clarifiesMessageId ? await ctx.db.get(message.clarifiesMessageId) : null;
  const task = message.clarifiedTaskId ? await ctx.db.get(message.clarifiedTaskId) : null;
  const event = task ? await ctx.db.get(task.eventId) : null;
  if (!pending || pending.resolvedByMessageId !== message._id || pending.expiresAt <= Date.now() || !source || source.clarifiesMessageId || source.provider !== "spectrum" || source.contentType !== "text/plain" || source.senderPhone !== user.verifiedPhoneE164 || message.senderPhone !== source.senderPhone || source.receivedAt > message.receivedAt || Date.now() - source.receivedAt > 15 * 60_000 || pending.sourceMessageId !== source._id || !task || !event || pending.eventId !== event._id || pending.eventVersion !== event.version || !pending.taskVersions.some(snapshot => snapshot.taskId === task._id && snapshot.version === task.version) || ["canceled", "completed"].includes(task.status)) throw new Error("STALE_TASK_CLARIFICATION");
  return { text: (await openEnvelope(source)).text, selectedTaskId: task._id, sourceMessageId: source._id };
}

export function taskChangingText(text: string): boolean {
  return /\b(?:cover|instead|swap|take|handle|bring|help|do|cancel|drop|can't|cannot|unavailable|change|move|switch|volunteer)\b/iu.test(text.replace(/[’‘]/gu, "'"));
}

export function taskChoices(text: string, tasks: Doc<"tasks">[], personalTaskIds: ReadonlySet<string>) {
  const live = tasks.filter(task => !["canceled", "completed"].includes(task.status));
  const explicit = live.filter(task => mentionsReference(text, task._id) || mentionsReference(text, task.title));
  if (explicit.length) return explicit;
  const personal = live.filter(task => personalTaskIds.has(task._id));
  return personal.length ? personal : live;
}

const oneLine = (text: string) => text.replace(/[\r\n\t\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, " ").replace(/\s+/gu, " ").trim();
export function taskQuestion(event: Doc<"events">, tasks: Doc<"tasks">[]): string {
  const choices = tasks.slice(0, 10).map((task, index) => {
    const duplicate = tasks.filter(other => other.title.toLowerCase() === task.title.toLowerCase()).length > 1;
    let time = "";
    if (duplicate && task.windowStart !== undefined) {
      try { time = ` — ${new Intl.DateTimeFormat("en-US", { timeZone: event.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(task.windowStart)}`; } catch { time = ` — ${new Date(task.windowStart).toISOString()}`; }
    }
    return `${index + 1}. ${oneLine(task.title).slice(0, 100)}${time}`;
  }).join("\n");
  return `${oneLine(event.title).slice(0, 150)}: which task do you mean?\n${choices}\nReply with the task name or number. No task changed.`;
}
