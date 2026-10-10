import { Spectrum } from "@spectrum-ts/convex";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { hashCode, invitationCode, openEnvelope, sealEnvelope } from "./lib/messaging";

export const spectrum = new Spectrum(components.spectrum, { mode: "immediate", debounceMs: 0 });

/** Synthetic runtime self-check only: no DB writes or provider calls. */
export const verifyRuntimeCrypto = internalMutation({
  args: { envelope: v.string() }, returns: v.boolean(),
  handler: async (_ctx, args): Promise<boolean> => {
    const envelope = await openEnvelope({ provider: "self-check", providerMessageId: "self-check", senderPhone: "+15550000000", bodyRedactedOrEncrypted: args.envelope });
    const code = await invitationCode("synthetic-runtime-check");
    return envelope.text === "Synthetic runtime check" && /^[A-F0-9]{32}$/.test(code) && /^[a-f0-9]{64}$/.test(await hashCode(code));
  },
});

export const checkRuntime = internalAction({
  args: {}, returns: v.object({ cryptoReady: v.boolean(), missingConfiguration: v.array(v.string()) }),
  handler: async (ctx): Promise<{ cryptoReady: boolean; missingConfiguration: string[] }> => {
    const missingConfiguration = ["SPECTRUM_PROJECT_ID", "SPECTRUM_PROJECT_SECRET", "SPECTRUM_WEBHOOK_SECRET", "RALLY_MESSAGING_KEY"].filter((name) => !process.env[name]);
    if (missingConfiguration.includes("RALLY_MESSAGING_KEY")) return { cryptoReady: false, missingConfiguration };
    const envelope = await sealEnvelope({ text: "Synthetic runtime check", spaceId: "synthetic-runtime-check" }, "self-check:self-check:+15550000000");
    const cryptoReady = await ctx.runMutation(internal.spectrum.verifyRuntimeCrypto, { envelope });
    return { cryptoReady, missingConfiguration };
  },
});
