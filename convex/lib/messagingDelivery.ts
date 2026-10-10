import type { MessagingAdapter, SendResult } from "../../packages/shared/adapters";
import { SendResultSchema } from "../../packages/shared/adapters";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

/** Shared by the actual sender and tests using FakeMessagingAdapter. */
export async function deliverWithAdapter(ctx: Pick<ActionCtx, "runMutation">, outboundMessageId: Id<"outboundMessages">, adapterFactory: (route: { spaceId: string; linePhone?: string }) => MessagingAdapter): Promise<null> {
  const claimed = await ctx.runMutation(internal.outbox.claim, { outboundMessageId });
  if (!claimed) return null;
  const { spaceId, linePhone, ...request } = claimed;
  let result: SendResult;
  try {
    const adapter = adapterFactory({ spaceId, ...(linePhone ? { linePhone } : {}) });
    result = SendResultSchema.parse(await adapter.send(request));
  } catch {
    // A thrown error may follow provider acceptance. Never retry speculatively.
    result = { state: "unknown" };
  }
  await ctx.runMutation(internal.outbox.settle, { outboundMessageId, state: result.state, ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}) });
  return null;
}
