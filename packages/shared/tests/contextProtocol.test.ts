import { describe, expect, it } from "vitest";
import { ContextPacketSchema } from "../contextPacket";
import { LegacyContextPacketSchema, legacyContextPacket } from "../contextProtocol";
import { evalCorpus } from "../../../tests/eval/corpus";

const rich = () => ({ ...evalCorpus.find(test => test.id === "25")!.packet });
describe("strict worker context rollout compatibility", () => {
  it("projects the old wire shape and keeps verified selection plus task facts in readable context", () => {
    const packet = rich();
    expect(LegacyContextPacketSchema.safeParse(packet).success).toBe(false);
    const legacy = legacyContextPacket(packet);
    expect(LegacyContextPacketSchema.safeParse(legacy).success).toBe(true);
    expect(legacy.relevantTasks.map(task => task.id)).toEqual([packet.selectedTaskId]);
    expect(legacy).not.toHaveProperty("selectedTaskId");
    expect(legacy.candidateEvents[0]).not.toHaveProperty("timezone");
    expect(legacy.relevantTasks[0]).not.toHaveProperty("capacity");
    expect(legacy.pendingProposalsForSender[0]).not.toHaveProperty("taskName");
    expect(legacy.incomingText).toContain(`Original participant message:\n${packet.incomingText}`);
    expect(legacy.incomingText).toContain('"selectedTaskId":"fixture_t_207"');
    expect(legacy.incomingText).toContain('"capacity":1');
    expect(legacy.incomingText).toContain('"timezone":"America/New_York"');
    expect(ContextPacketSchema.parse(packet)).toMatchObject({ selectedTaskId: "fixture_t_207", relevantTasks: expect.arrayContaining([expect.objectContaining({ capacity: 1, window: expect.any(Object) })]) });
  });
  it("does not carry another sender, unrelated event or unselected-task offer into the fallback", () => {
    const packet = rich(); const offer = packet.pendingProposalsForSender[0]!;
    packet.pendingProposalsForSender.push({ ...offer, id: "wrong_sender", targetUserId: "outsider" }, { ...offer, id: "private_offer", eventId: "private_event", taskName: "private budget" }, { ...offer, id: "other_task", targetTaskId: "fixture_t_496", taskName: "setup" });
    const legacy = legacyContextPacket(packet);
    expect(legacy.pendingProposalsForSender).toHaveLength(1);
    for (const text of ["wrong_sender", "private_event", "private budget", "other_task", '"fixture_t_496"']) expect(JSON.stringify(legacy)).not.toContain(text);
  });
  it("never truncates the participant's instruction or exceeds the 16k input bound", () => {
    const packet = { ...rich(), incomingText: "x".repeat(16_000) };
    expect(legacyContextPacket(packet).incomingText).toBe(packet.incomingText);
    expect(legacyContextPacket(packet).relevantTasks.map(task => task.id)).toEqual([packet.selectedTaskId]);
  });
  it("rejects invalid selected tasks and extra private fields", () => {
    expect(() => legacyContextPacket({ ...rich(), selectedTaskId: "not_in_scope" })).toThrow("INVALID_SELECTED_TASK");
    expect(() => legacyContextPacket({ ...rich(), contacts: ["secret"] } as ReturnType<typeof rich>)).toThrow();
  });
});
