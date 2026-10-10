"use node";
import { v } from "convex/values";
import { createCloudSender } from "@spectrum-ts/convex/sender";
import { internalAction } from "./_generated/server";
import { deliverWithAdapter } from "./lib/messagingDelivery";
import type { MessagingAdapter } from "../packages/shared/adapters";
// Static imports ensure Convex ships optional peers needed by gRPC at runtime.
export * as _grpcJs from "@grpc/grpc-js";
export * as _niceGrpc from "nice-grpc";
export * as _niceGrpcCommon from "nice-grpc-common";

export const deliver = internalAction({
  args: { outboundMessageId: v.id("outboundMessages") }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => deliverWithAdapter(ctx, args.outboundMessageId, (route): MessagingAdapter => ({
    async send(request) {
      if (!process.env.SPECTRUM_PROJECT_ID || !process.env.SPECTRUM_PROJECT_SECRET) return { state: "failed", errorCode: "PROVIDER_NOT_CONFIGURED" };
      const result = await createCloudSender().deliver({ rowId: args.outboundMessageId, clientGuid: request.idempotencyKey, kind: "send", content: request.content, spaceId: route.spaceId, ...(route.linePhone ? { phone: route.linePhone } : {}) });
      // The SDK collapses provider errors/timeouts into ok=false. Conservatively
      // hold all such outcomes for operator reconciliation; never auto retry.
      return result.ok ? { state: "sent", ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}) } : { state: "unknown", errorCode: "PROVIDER_OUTCOME_UNCERTAIN" };
    },
  })),
});
