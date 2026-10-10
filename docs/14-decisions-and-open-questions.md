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

## Blocking questions (resolve in first 2 hours)

### Lane A update, 2026-10-10

Follow-up: local Convex authentication works; selecting `rally:dev/caleb-han` resolves to `calm-jackal-984`, which this checkout already referenced. The earlier assumption that it was a different personal deployment was incorrect. Component codegen and development deployment pass. All required messaging configuration is present, and the synthetic cloud crypto check passes without writes or sends. Photon accepts the project credentials and lists exactly one webhook at the intended endpoint. **101 local tests pass**, including a regression for Photon's documented `iMessage` platform spelling. A real HELP DM is durably processed, its reply is provider-accepted with one attempt, and the user confirmed phone receipt. A constructed signed replay of that real message ID returns 200 with no second inbox row or reply. See the sanitized [transport trace](19-messaging-evidence.md).

- **Q1 account:** Supplied Photon project `4dad8b60-5af7-483c-91fa-d9f806d7c63a` (`rally`, Pro). The pasted dashboard initially reported `account_phone_missing`; phone and secrets are now configured and a real one-phone HELP round trip passes. Two-phone assignments, promotion expiry and group entitlement remain **VERIFY**.
- **Q2 SDK:** Installed/source-checked `@spectrum-ts/convex` **0.1.1**, core/iMessage **12.10.1**. Native verification, encrypted per-message inbox and consent-gated outbox use the official sender. The component does not forward its deterministic GUID to the provider; uncertain outcomes are held without automatic retries. Native JSON and external gRPC peers are required. See [API differences and evidence](19-messaging-evidence.md).
- **Milestone:** Lane A strict checks and **101 tests** pass with signed **synthetic** webhooks, invitation/opt-out/outbox tests and B/C **test-double** routing. Development deployment and cloud encryption/HMAC self-check pass. T0's real inbound/reply smoke test passes, including actual gRPC sending and user-observed phone receipt. Live JOIN and M1 remain incomplete: organizer authentication/event creation, actual domain status/proposal response/cancellation and reasoning remain B/C stubs.
- **Live onboarding follow-up:** A real STATUS message was processed and produced only the fixed invitation instructions, with one provider-accepted send and user-confirmed receipt. This passes unknown-user onboarding (A6); it does not prove enrolled-event STATUS/ST-17. Lane A is ready for integration, with real JOIN and enrolled status still required for the lane's complete live exit criterion.
- **Immediate choice:** Use the component's verifier/redacted routing registry with Rally's own per-message scheduler and outbox to preserve approvals and hold unknown delivery outcomes. HMAC-derived invitation codes are hashed at rest. No frozen schema or existing signatures changed. No live provider capability is implied.


1. **Photon account:** The briefs list two promo codes (`HACKNC` in the track blurb, `HACKWITHPHOTON` in the Notion guidelines); record which one activated Pro and when the free month ends. Does hackathon promo provide just shared Pro DMs or special dedicated/group permissions (ADR-012)? Can newly selected contacts be invited compliantly, and how does participant provisioned number flow work? Record actual test.
2. **Convex component:** Which installed `@spectrum-ts/convex` version, and how do replies, grouping/collapse, outbound IDs, and explicit send capabilities behave? Pin versions.
3. **Claude runtime:** Which Claude account tier/model is accessible? Can local Agent SDK/`claude -p` be used for the intended prototype under current Anthropic terms, and what are real latency/rate limits? Test from Mac with a safe one-turn JSON task.
4. **App authentication:** Which supported iOS/Convex auth provider is fastest for real organizer identity? Do not leave public mutations exposed.
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
