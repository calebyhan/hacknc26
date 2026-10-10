import { z } from "zod";
import { AgentDecisionSchema, type AgentDecision } from "./agentDecision";
import { ContextPacketSchema, type ContextPacket } from "./contextPacket";
import { IdentifierSchema, PhoneE164Schema } from "./primitives";

export const SendRequestSchema = z.strictObject({
  idempotencyKey: z.string().min(1).max(256),
  recipientUserId: IdentifierSchema,
  toPhoneE164: PhoneE164Schema,
  eventId: IdentifierSchema.optional(),
  proposalId: IdentifierSchema.optional(),
  content: z.string().min(1).max(4_000),
});
// A send result cannot claim delivery. Receipts belong to a separate ingress path.
export const SendResultSchema = z.strictObject({
  state: z.enum(["sent", "failed", "unknown"]),
  providerMessageId: IdentifierSchema.optional(),
  errorCode: z.string().min(1).max(128).optional(),
});
export type SendRequest = z.infer<typeof SendRequestSchema>;
export type SendResult = z.infer<typeof SendResultSchema>;

export interface MessagingAdapter {
  send(request: SendRequest): Promise<SendResult>;
}
export interface InferenceProvider {
  decide(packet: ContextPacket): Promise<AgentDecision>;
}

export type FakeSendOutcome = "sent" | "failed" | "timeout";

/** Simulation only: records every attempt, including duplicate logical sends. */
export class FakeMessagingAdapter implements MessagingAdapter {
  readonly sends: SendRequest[] = [];
  private outcome: FakeSendOutcome;
  private readonly queuedOutcomes: FakeSendOutcome[] = [];

  constructor(options: { outcome?: FakeSendOutcome } = {}) {
    this.outcome = options.outcome ?? "sent";
  }

  setOutcome(outcome: FakeSendOutcome): void {
    this.outcome = outcome;
  }

  queueOutcome(outcome: FakeSendOutcome): void {
    this.queuedOutcomes.push(outcome);
  }

  async send(request: SendRequest): Promise<SendResult> {
    this.sends.push(SendRequestSchema.parse(request));
    const outcome = this.queuedOutcomes.shift() ?? this.outcome;
    if (outcome === "timeout") return { state: "unknown", errorCode: "FAKE_TIMEOUT" };
    if (outcome === "failed") return { state: "failed", errorCode: "FAKE_FAILURE" };
    return { state: "sent", providerMessageId: `fake_message_${this.sends.length}` };
  }
}

/** Simulation only: never calls a model or accepts a script for a different text. */
export class FakeInferenceProvider implements InferenceProvider {
  readonly calls: ContextPacket[] = [];
  private readonly scripts = new Map<string, AgentDecision>();

  constructor(scripts: Readonly<Record<string, AgentDecision>> = {}) {
    for (const [text, decision] of Object.entries(scripts)) this.script(text, decision);
  }

  script(text: string, decision: AgentDecision): void {
    this.scripts.set(text, AgentDecisionSchema.parse(decision));
  }

  async decide(packet: ContextPacket): Promise<AgentDecision> {
    const validatedPacket = ContextPacketSchema.parse(packet);
    this.calls.push(validatedPacket);
    const decision = this.scripts.get(validatedPacket.incomingText);
    if (!decision) throw new Error("NO_SCRIPTED_DECISION");
    return AgentDecisionSchema.parse(decision);
  }
}
