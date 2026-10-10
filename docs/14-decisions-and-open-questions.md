# Architecture decisions and open questions

**Decision states:** `DECIDED` means user/team direction; `PROPOSED` means recommended but unimplemented; `VERIFY` means provider/account behavior must be tested. **Do not silently turn VERIFY into fact.**

## Decisions

| ID | State | Decision / rationale |
|---|---|---|
| ADR-001 | DECIDED | Required HackNC track: General; required sponsor track: Photon with Spectrum. Other tracks opportunistic. |
| ADR-002 | DECIDED | iMessage is the principal interface; iOS is setup/contact selection/status, not primary chat UI. |
| ADR-003 | DECIDED | Need both structured event and casual friend-group planning eventually; event-first MVP. Schema includes `kind:event|project`; only `event` is exposed in MVP UX. |
| ADR-004 | DECIDED | Mac (Apple Silicon category, exact model/RAM unknown) and existing Claude Code subscription; no assumed paid inference API. |
| ADR-005 | PROPOSED | Convex + Photon official `@spectrum-ts/convex` integration for durable messaging and serverless state. |
| ADR-006 | PROPOSED | Local Claude worker invoked via permitted subscription access; deterministic fallback for confirmations and status. |
| ADR-007 | PROPOSED | Proposals require affected participant approval; task writes only through validated transactions. |
| ADR-008 | PROPOSED | Weather watch via Open-Meteo is P1; never unilaterally reschedules event. |
| ADR-009 | PROPOSED | Selected contacts → invite state → participant-initiated verified opt-in; avoid contact bulk sync. |
| ADR-010 | PROPOSED | Single-event status view before widget and additional calendar integrations. |
| ADR-011 | DECIDED | Reassignment, cancellation and organizer-approval policy. See below. |
| ADR-012 | VERIFY | MVP is 1:1 DMs only; group-chat participation depends on Photon permissions. See below. |
| ADR-013 | DECIDED | P0 does not depend on the iOS app; events are created via iMessage draft or a labeled bootstrap script. See below. |
| ADR-014 | DECIDED | Persisted state enums live only in `03-data-model.md#canonical-state-enums`; display labels are derived (`06-workflows.md#status-vocabulary`). |
| ADR-015 | DECIDED | Two-level optimistic versioning: `events.version` for event-level fields, `tasks.version` per task; proposals and worker output check both (`03-data-model.md` invariants 5–6). Prevents one task's change from invalidating offers on other tasks. |
| ADR-016 | DECIDED | Prompt 0 freezes concrete stub contracts and test tooling, including typed JSON worker envelopes and persisted task-version snapshots. Product behavior and provider capabilities remain unverified. |
| ADR-017 | DECIDED / VERIFY | Lane D uses the official Convex Swift Auth0 adapter with explicit demo mode. SDK interfaces are verified; tenant configuration, backend authorization and physical-device sign-in remain unverified. |

### ADR-011 — Reassignment, cancellation and organizer approval
- Date: 2026-10-10
- State: DECIDED (user delegated the call to the agent, 2026-10-10)
- Context: README/demo use both “Can Jordan cover setup?” (suggestion) and “Maya can't make it” (cancellation). A2 said “handled according to policy” with no policy; W3 reverted a declined replacement to the canceled person; “organizer approval where required” was undefined.
- Decision:
  - *Organizer suggests replacement:* current assignee stays `active` until target accepts; on accept → old commitment `released`, one notice to the old assignee. Decline/expiry → no change.
  - *Assignee self-cancels:* commitment `canceled_by_participant`, task `needs_coverage`, organizer notified.
  - *Organizer reports someone unavailable:* treated as an audited organizer override; commitment `released`, task `needs_coverage`, one notice to that person. A declined replacement leaves the task `needs_coverage`.
  - *Non-organizer reports someone else unavailable:* no state change.
  - *Organizer approval (`requiresOrganizerApproval`)* is required when a non-organizer proposes assigning someone other than themself, and for planner-recommended candidates (W5) before the candidate is contacted. Not required for organizer-initiated proposals or self-commitments to open tasks (organizer is notified).
- Alternatives: require the reported person's direct confirmation before releasing (safer, slower, needs a second reply in the demo); auto-release on any member report (rejected: third-party testimony).
- Impact on tests/security: A2 asserts Maya `released`; add tests for organizer-report → `needs_coverage` and declined replacement staying `needs_coverage`; non-organizer report → no write (ST-18 in `11-testing-and-demo.md`).
- Evidence / link: `06-workflows.md` W3, `05-agent-reasoning.md` action union.

### ADR-012 — DM-only MVP vs group-chat participation
- Date: 2026-10-10
- State: VERIFY
- Context: Photon's track brief lists “agents that join human-to-human conversations” first, and judging weights **Vision**. Public pricing puts full group-messaging API on Business; Pro shared lines are DM-oriented.
- Decision: Build P0 on enrolled 1:1 DMs sharing one canonical event state. Ask Photon (Discord) in hour 0–2 whether the hackathon Pro grants group-chat access. If yes, add “Rally responds when mentioned in an existing group chat, scoped to that chat's linked event” as P1 after the P0 gate; if no, frame DM fan-out as the deliberate privacy design in the pitch.
- Alternatives: require group chat for P0 (rejected: unverified entitlement could block the whole demo).
- Impact on tests/security: group chat would need per-chat event scoping and must not leak one member's DM-only data into the group.
- Evidence / link: pasted Photon guidelines; `04-messaging-and-photon.md` plan-tier constraints.

### ADR-013 — P0 without the iOS app
- Date: 2026-10-10
- State: DECIDED (user delegated the call to the agent, 2026-10-10)
- Context: R2/R3 required the contact picker and in-app event creation, but the iOS screen is P1 and SwiftUI is scheduled after the core loop.
- Decision: P0 event/task/invited-membership creation uses either the iMessage draft flow (W2) or a labeled bootstrap script run by an authenticated organizer **before** the demo. Neither path sends invitations; participants still `JOIN <code>`. The iOS contact picker replaces the bootstrap path in P1.
- Alternatives: promote the iOS create/select screen to P0 (costs ~4h before the reassignment loop exists).
- Impact on tests/security: bootstrap script must use the same authorized mutations (no admin bypass) and be disclosed as setup, not shown as a live agent action.
- Evidence / link: `01-scope-and-acceptance.md` R2/R3.

### ADR-016 — Bootstrap contract and verification boundary
- Date: 2026-10-10
- State: DECIDED (routine implementation choices within the authorized Prompt 0 task)
- Context: `17` fixed function names but omitted argument/return shapes, left the command router kind open, and described worker authorization without a function kind. `03` omitted inbound processing states and nested field shapes. No package manifest, source code, tests or deployment configuration existed at kickoff.
- Decision:
  - Use npm workspaces with strict TypeScript. Pin Convex 1.46.0, Zod 4.6.5, TypeScript 7.0.2, Vitest 5.0.3 and convex-test 0.0.61, verified from the npm registry and current official setup documentation. Local toolchain: Node 26.0.0, npm 11.12.1; CI targets Node 24 LTS.
  - `commands.route` is an internal mutation. Worker claim/complete/heartbeat are public mutations whose future implementation must verify a dedicated server-side worker credential. All handlers, including auth, currently throw; accepting a token argument is not implemented authentication.
  - Shared Zod schemas are the only message/intent/decision packet definitions. Convex uses explicit JSON-string envelopes (`decisionJson`, `packetJson`) where those objects cross its API. Lane B/C must parse with the shared schemas, resolve IDs, and authorize/version-check before acting. JSON serialization does not make model output trustworthy.
  - Store the event version and referenced-task versions on each reasoning job; each claim gets a distinct lease token. A completion cannot replace the stored snapshot by supplying newer versions.
  - Persist the job's event ID. Explicit null event/version jobs support first-event drafting and clarification only, with no existing-event writes. Persist an outbound message's direct-reply source so send/retry code can recheck the documented onboarding/STOP exception.
  - Add optional task location and serialized task-change proposal payload so the existing `PROPOSE_TASK_CHANGE` union has durable proposed data without overwriting the committed task.
  - Add canonical inbound processing states and proposal categories to `03`; fix nested settings/weather shapes there. No existing enum value or function name is renamed.
  - `seed.bootstrap` stays internal. Lane B must require verified organizer identity and use the same authorization/creation helpers as public organizer mutations. Fake fixtures are not proof of consent and cannot silently enroll real participants.
  - Keep auth, routing, domain transitions, provider integration, inference and weather scheduling unimplemented. The empty cron configuration cannot invoke the weather stub.
- Alternatives: duplicate the full Zod action union as Convex validators (rejected: two schema sources); run the command router as an action (deferred until a demonstrated need for external I/O); treat administrative seeding as consent (rejected by ADR-013).
- Impact on tests/security: contract validation, strict unknown-field rejection, explicit API visibility, fixture/schema compatibility, throwing-stub behavior, and worker config handling are tested. They do not satisfy A1–A10 or replace the live Photon smoke test.
- Evidence / link: package lock and `18-bootstrap-contract.md`. Human Convex setup completed; strict root/workspace typechecks, 64 tests, and the cloud development schema/stub deployment passed. This proves the Prompt 0 contract gate, not the live Photon or P0 product gates.

### ADR-017 — iOS authentication adapter and honest integration boundary
- Date: 2026-10-10
- State: DECIDED (routine Lane D implementation); VERIFY (live identity and device setup)
- Context: Lane D can build its setup/status UI against frozen query contracts, but all public app functions and authorization helpers still throw. No iOS auth tenant or public phone-link challenge contract is configured in this branch.
- Decision:
  - Pin `convex-swift` 0.8.1 (`ConvexMobile`), `convex-swift-auth0` 0.4.0 (`ConvexAuth0`), and the adapter's required `Auth0.swift` 2.17.0 (`Auth0`). Use the official Auth0 provider for Universal Login, ID-token authentication and credential refresh; never submit a client-supplied user ID or server credential.
  - Keep blank public app configuration in source control. Load deployment URL/domain/client ID from a git-ignored local xcconfig; generate the SDK's `Auth0.plist` at build time. Missing/placeholder configuration disables live sign-in before SDK initialization.
  - Keep a labeled, explicitly selected local demo client. Live subscription failures surface an error, clear protected query data, and never switch to demo. Observe Convex WebSocket state only as connectivity, never as proof of message delivery or model health.
  - Until Lane A supplies a real challenge/status/provisioned-number contract, the app cannot display an actual phone-link code or an invented shared Rally number. Lane B retains ownership of auth enforcement and read models.
  - Use iOS 17 as the minimum deployment target and Swift 6 language mode. The identified device is an iPhone 16 Pro on iOS 27.0.1, with temporary direct installation from Xcode requested. Actual pairing/signing with installed Xcode 26.6 remains to be verified; no TestFlight setup is required for this slice.
- Alternatives: Clerk is also documented by Convex; switching remains possible behind `RallyClient`/`AppSession` if the team already has a configured tenant. Custom passwordless auth is deferred because it adds identity and refresh-token implementation work.
- Impact on tests/security: test public configuration validation, plain numeric wire encoding (Swift SDK integer encoding is a different Convex type), omitted optionals, selected-contact payloads, and explicitly simulated state changes. Mock authorization tests do not prove server authorization. Auth0 sign-in does not prove control of a phone number or enrollment.
- Evidence / link: official [Swift overview](https://docs.convex.dev/client/swift/overview), [Convex 0.8.1 source](https://github.com/get-convex/convex-swift/tree/0.8.1), [Auth0 adapter 0.4.0 manifest/source](https://github.com/get-convex/convex-swift-auth0/tree/0.4.0), [app verification record](../ios/Rally/README.md), and [Lane D continuation](../prompts/lane-d-ios-remaining.md). Package signatures and versions were read from these sources. The user reported successful simulator sign-in; backend token acceptance, physical-device operation, live delivery and ST-15 remain unverified.

## Blocking questions (resolve in first 2 hours)

1. **Photon account:** The briefs list two promo codes (`HACKNC` in the track blurb, `HACKWITHPHOTON` in the Notion guidelines); record which one activated Pro and when the free month ends. Does hackathon promo provide just shared Pro DMs or special dedicated/group permissions (ADR-012)? Can newly selected contacts be invited compliantly, and how does participant provisioned number flow work? Record actual test.
2. **Convex component:** Which installed `@spectrum-ts/convex` version, and how do replies, grouping/collapse, outbound IDs, and explicit send capabilities behave? Pin versions.
3. **Claude runtime:** Which Claude account tier/model is accessible? Can local Agent SDK/`claude -p` be used for the intended prototype under current Anthropic terms, and what are real latency/rate limits? Test from Mac with a safe one-turn JSON task.
4. **App authentication:** Auth0 adapter selected for Lane D (ADR-017). Which tenant/native application and authorized test identities will the team configure, and how will Lane B provision their `users` rows? Public functions must enforce identity plus membership/role before live use.
5. **Phone linking:** Exact sender metadata in Photon webhook, canonicalization rules, and proof-of-control enrollment behavior.
6. **Device and test participants:** Exact Mac chip/RAM, team size, number of opted-in test phones and distribution pathway for iOS demo.
7. **Event location:** Are actual coordinates known for weather, or should organizers provide validated location? Avoid fabricating geocodes.

## Non-blocking questions

- Should “casual mode” have explicit RSVPs or lightweight interest counts?
- Is the iOS widget worth the time after full acceptance gate?
- Which optional calendar integration is most useful if time remains?

## Decision log template

```markdown
### ADR-016 — [Title]
- Date:
- State: DECIDED / PROPOSED / VERIFY / SUPERSEDED
- Context:
- Decision:
- Alternatives:
- Impact on tests/security:
- Evidence / link:
```

A coding agent should update this file when verifying account behavior or choosing an architecture variant.
