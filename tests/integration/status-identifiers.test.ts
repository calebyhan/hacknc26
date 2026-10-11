import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagingHarness } from "./harness";

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T18:00:00Z"));
  vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
  vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "integration-webhook-secret");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

it("STATUS disambiguates same-titled enrolled events with usable IDs, without exposing another person's event (simulation)", async () => {
  const h = await messagingHarness();
  const create = "CREATE EVENT Rehearsal Picnic | 2026-10-12T18:00:00Z | America/New_York | Fixture park";
  const ids: string[] = [];
  for (const providerId of ["fixture-draft-one", "fixture-draft-two"]) {
    const source = await h.receive(h.phones.alex, create, providerId);
    const reply = h.fake.sends.at(-1)!.content;
    const code = /JOIN ([A-F0-9]{32})/.exec(reply)![1]!;
    const eventId = /CONFIRM (\S+) 1/.exec(reply)![1]!;
    ids.push(eventId);
    await h.receive(h.phones.alex, `JOIN ${code}`);
    // Replaying a provider ID does not create another event.
    expect(await h.receive(h.phones.alex, create, providerId)).toBe(source);
  }
  await h.receive(h.phones.jordan, create.replace("Rehearsal Picnic", "Private fixture"));
  const privateId = /CONFIRM (\S+) 1/.exec(h.fake.sends.at(-1)!.content)![1]!;
  await h.receive(h.phones.alex, "STATUS");
  const status = h.fake.sends.at(-1)!.content;
  for (const id of ids) expect(status).toContain(`Rehearsal Picnic [${id}]`);
  expect(status).not.toContain(privateId);
  expect(status).not.toContain("Private fixture");
  expect(await h.t.run(ctx => ctx.db.query("events").collect())).toHaveLength(3);
});
