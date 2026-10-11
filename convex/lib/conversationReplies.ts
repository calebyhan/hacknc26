import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { AgentDecisionSchema } from "../../packages/shared/agentDecision";

/** A newer verified setup exchange supersedes old generic model questions.
 * Receipts survive wizard completion; task offers and acceptance notices do not
 * use this gate and remain governed by their own domain snapshots. */
export async function hasNewerSetupReply(ctx: QueryCtx | MutationCtx, userId: Id<"users">, source: Doc<"inboundMessages">): Promise<boolean> {
  const receipts = await ctx.db.query("phoneSetupReceipts").withIndex("by_user", q => q.eq("userId", userId)).order("desc").take(10);
  for (const receipt of receipts) {
    const newer = await ctx.db.get(receipt.messageId);
    if (newer?.provider === "spectrum" && newer.senderPhone === source.senderPhone &&
      (newer.receivedAt > source.receivedAt || newer.receivedAt === source.receivedAt && newer._creationTime > source._creationTime)) return true;
  }
  return false;
}

export async function staleConversationReply(ctx: QueryCtx | MutationCtx, row: Doc<"outboundMessages">): Promise<boolean> {
  if (!row.directReplyToMessageId) return false;
  const match = /^job:([^:]+):(?:(\d+):reply|clarify|staffing-clarify)$/u.exec(row.idempotencyKey);
  if (!match) return false;
  const jobId = ctx.db.normalizeId("reasoningJobs", match[1]!);
  const job = jobId ? await ctx.db.get(jobId) : null;
  if (!job || job.messageId !== row.directReplyToMessageId) return false;
  // REQUEST_STATUS shares the indexed reply key. Only suppress actual generic
  // question/no-action replies, never a requested status snapshot or receipt.
  if (match[2] !== undefined) {
    try {
      const decision = AgentDecisionSchema.parse(JSON.parse(job.executedDecisionJson ?? job.result ?? "null"));
      const action = decision.actions[Number(match[2])];
      if (!action || !["ASK_CLARIFICATION", "NO_ACTION"].includes(action.type)) return false;
    } catch { return false; }
  }
  const source = await ctx.db.get(row.directReplyToMessageId);
  return !!source && await hasNewerSetupReply(ctx, row.recipientUserId, source);
}
