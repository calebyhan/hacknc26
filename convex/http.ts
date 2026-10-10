import { httpRouter } from "convex/server";
import { headerRecord, parseWebhook } from "@spectrum-ts/convex";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { PhotonTextMessageSchema } from "../packages/shared/commands";
import { sealEnvelope } from "./lib/messaging";
import { spectrum } from "./spectrum";

// Native signed Photon ingress; real cloud traffic is still a smoke-test gate.
const http = httpRouter();
// Reuse the component's native HMAC verifier; persist the minimized encrypted
// inbox separately to avoid burst/cancellation semantics for approvals. The
// component retains only redacted content and verified routing metadata.
http.route({ path: "/spectrum/webhook", method: "POST", handler: httpAction(async (ctx, request) => {
  const secret = process.env.SPECTRUM_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > 65_536) return new Response("Payload too large", { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > 65_536) return new Response("Payload too large", { status: 413 });
  const verified = await parseWebhook({ bodyBytes: bytes, headers: headerRecord(request.headers), secret });
  if (!verified.ok) return new Response(verified.status === 200 ? "Ignored" : "Invalid webhook", { status: verified.status });
  const envelope = verified.message.raw as { message?: unknown };
  const parsed = PhotonTextMessageSchema.safeParse(envelope.message);
  if (!parsed.success || !verified.message.triggersTurn) return new Response("Ignored unsupported input", { status: 200 });
  const message = parsed.data;
  try {
    const bodyRedactedOrEncrypted = await sealEnvelope({ text: message.content.text, spaceId: message.space.id, ...(message.space.phone ? { linePhone: message.space.phone } : {}) }, `spectrum:${message.id}:${message.sender.id}`);
    await ctx.runMutation(spectrum.component.inbound.enqueue, { spaceId: message.space.id, messageId: message.id, platform: "imessage", senderId: message.sender.id, content: { type: "text", text: "[redacted]" }, spaceType: "dm", ...(message.space.phone ? { phone: message.space.phone } : {}), triggersTurn: false, mode: "immediate" });
    await ctx.runMutation(internal.inbound.ingest, { provider: "spectrum", providerMessageId: message.id, senderPhone: message.sender.id, receivedAt: Date.now(), contentType: "text/plain", bodyRedactedOrEncrypted });
    return new Response("ok", { status: 200 });
  } catch {
    return new Response("Persistence unavailable", { status: 503 });
  }
}) });
export default http;
