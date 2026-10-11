import { describe, expect, it } from "vitest";

const modules = import.meta.glob<Record<string, unknown>>(
  ["../../convex/*.ts", "!../../convex/*.test.ts", "!../../convex/convex.config.ts"],
  { eager: true },
);
const expected = [
  ["accounts.register", "public mutation"],
  ["accounts.current", "public query"],
  ["accounts.beginPhoneLink", "public mutation"],
  ["accounts.completePhoneLink", "public mutation"],
  ["appStatus.event", "public query"],
  ["appStatus.overview", "public query"],
  ["appStatus.route", "public query"],
  ["appStatus.recordProvisionedRoute", "internal mutation"],
  ["appStatus.revokeProvisionedRoute", "internal mutation"],
  ["commands.route", "internal mutation"],
  ["commitments.reportUnavailable", "internal mutation"],
  ["context.buildPacket", "internal query"],
  ["domain.executeDecision", "internal mutation"],
  ["domain.statusFor", "internal query"],
  ["events.confirmDraft", "public mutation"],
  ["events.create", "public mutation"],
  ["events.detail", "public query"],
  ["events.myEvents", "public query"],
  ["events.organizerInvitation", "public mutation"],
  ["identity.setMessagingState", "internal mutation"],
  ["inbound.ingest", "internal mutation"],
  ["invitations.createForContacts", "public mutation"],
  ["invitations.redeem", "internal mutation"],
  ["outbox.enqueue", "internal mutation"],
  ["proposals.cancelForUser", "internal mutation"],
  ["proposals.create", "internal mutation"],
  ["proposals.organizerApprove", "internal mutation"],
  ["proposals.respond", "internal mutation"],
  ["proposals.approve", "public mutation"],
  ["proposals.expire", "internal mutation"],
  ["proposals.recommendReplacement", "internal mutation"],
  ["reasoningJobs.claim", "public mutation"],
  ["reasoningJobs.complete", "public mutation"],
  ["reasoningJobs.enqueue", "internal mutation"],
  ["reasoningJobs.heartbeat", "public mutation"],
  ["seed.bootstrap", "internal mutation"],
  ["tasks.create", "public mutation"],
  ["weather.check", "internal action"],
];

interface Registration {
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  isInternal?: boolean;
  isPublic?: boolean;
  exportArgs: () => string;
  exportReturns: () => string;
}

function isRegistration(value: unknown): value is Registration {
  return typeof value === "function" && "exportArgs" in value && "exportReturns" in value;
}

const registrations = Object.entries(modules).flatMap(([file, module]) =>
  Object.entries(module).flatMap(([name, value]) =>
    isRegistration(value) ? [{ name: `${file.split("/").at(-1)?.replace(/\.ts$/, "")}.${name}`, value }] : [],
  ),
);

describe("frozen backend contract", () => {
  it("registers every agreed function with the correct visibility and kind", () => {
    const actual = registrations.map(({ name, value }) => [
      name,
      `${value.isInternal ? "internal" : "public"} ${value.isQuery ? "query" : value.isMutation ? "mutation" : "action"}`,
    ]).sort(([a = ""], [b = ""]) => a.localeCompare(b));
    // Preserve all frozen contracts while permitting additive internal Lane A
    // delivery functions. No bootstrap signature or visibility is replaced.
    for (const entry of expected) expect(actual).toContainEqual(entry);
    for (const [name, kind] of actual) {
      if (!expected.some(([expectedName]) => expectedName === name)) {
        expect(["outbox.claim", "outbox.settle", "outbox.markUnknown", "spectrumSender.deliver", "spectrum.checkRuntime", "spectrum.verifyRuntimeCrypto", "reasoningJobs.expire", "phoneSetup.execute"]).toContain(name);
        expect(kind).toMatch(/^internal /);
      }
    }
    for (const { value } of registrations) {
      expect(Boolean(value.isInternal) !== Boolean(value.isPublic)).toBe(true);
    }
  });

  it("declares bounded argument and return validators on every function", () => {
    for (const { name, value } of registrations) {
      const args: unknown = JSON.parse(value.exportArgs());
      const returns: unknown = JSON.parse(value.exportReturns());
      expect(args, name).toBeTruthy();
      expect(returns, name).toBeTruthy();
      expect(JSON.stringify(args), name).not.toContain('"type":"any"');
      expect(JSON.stringify(returns), name).not.toContain('"type":"any"');
    }
  });

  it("makes the server-verifiable worker token explicit on all worker endpoints", () => {
    for (const method of ["claim", "complete", "heartbeat"]) {
      const endpoint = registrations.find(({ name }) => name === `reasoningJobs.${method}`);
      expect(endpoint).toBeDefined();
      expect(endpoint?.value.exportArgs()).toContain('"workerToken"');
    }
  });
});
