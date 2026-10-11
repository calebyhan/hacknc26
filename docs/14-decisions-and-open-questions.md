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
| ADR-018 | DECIDED | Auth0 app identity is distinct from phone/event messaging consent; explicit phone challenge and event JOIN bind them. Domain execution and response proof use transactional idempotency. See Lane B evidence. |
| ADR-019 | DECIDED / VERIFY | Scoped queue/Domain deployed to development and local Codex worker online; actual enrolled iMessage AI flow remains pending. |

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

### Lane D + A/B merge review, 2026-10-10

The user authorized merging Lane D first, pulling `main`, then integrating A/B; live M1 testing is explicitly deferred. Lane D's merge preserves ADR-017; Lane B's colliding identity/domain decision is now ADR-018. Independent integration review found the frozen Swift query/mutation signatures compatible and Lane C execution-cache additions optional. Original lane-owner acknowledgments were not collected; this merge follows the user's explicit instruction, with cross-lane review and tests recorded in [integration evidence](21-messaging-domain-integration.md#combined-merge-validation).

M1 remains the current live milestone. The existing seed cannot establish real consent or assignments. The [corrected M1 runbook](../prompts/m1-messaging-domain.md) uses genuine authenticated setup and actual participant JOIN/YES/NO. The iOS app's account registration, phone-link, task-time and event-confirmation/opt-in wiring remains M2 work; backend availability alone does not complete that app flow. Earlier branch-specific statements below are historical evidence, not the combined checkout's current implementation status.

### Lane A–B integration follow-up, 2026-10-10

**173 tests in 11 files pass**, including 13 signed synthetic webhook → actual scheduled router/domain → fake provider pipeline scenarios. Regression tests first reproduced delayed STOP/LEAVE cancellation races, stale-offer ambiguity and status incorrectly labeling organizer approval as participant response. STOP/LEAVE now cancel pending offers transactionally; YES/NO selects snapshot-valid offers; shared status counts distinguish both approval stages. No persisted state enum or endpoint signature changed; optional `approvalCount` extends the shared copy input. See [integration evidence](21-messaging-domain-integration.md). Actual multi-phone M1 and real app login remain unverified; no fake fixture was deployed as live event consent.

The fixes deployed to teammate `dev/caleb-han` at 5:18:04 PM EDT. Post-deployment crypto readiness passes, anonymous event access is denied, and an unsigned webhook is rejected (HTTP 400). Contract inventory remains 38 functions, and `git diff --check` passes.

### Lane B update, 2026-10-10

The user selected **Auth0** and saved its public tenant domain/client ID on `rally:dev/caleb-han` (`calm-jackal-984`). Both server values are present and HTTPS issuer discovery succeeds. A genuine app session/login has not been observed. The backend now checks verified app identity and enrolled membership/organizer role; signing in alone does not verify a phone or grant event access.

Lane B implements T1/T3 and the deterministic T7 planner. **160 tests in 10 files pass**, including the required ST-04/05/06/08/09/10/13/18 and worker-free ST-11 paths under encrypted synthetic messages/fake delivery. The actual Lane A router and outbox are integrated in those tests. Live enrolled JOIN/STATUS and the two-phone M1 acceptance gate remain pending. Lane C inference/context/weather remain throwing stubs. See [domain evidence, contract additions and authenticated setup](20-domain-evidence.md).

Deployment succeeded to the teammate's development deployment at 4:57:39 PM EDT. Cloud public APIs reject anonymous queries/registration and a forged token; messaging crypto configuration remains ready. No fake seed or real assignment/send was run during verification. Contract inventory now contains 38 functions.

ADR-018 (routine choices within the authorized Lane B implementation; renumbered from Lane B's ADR-017 when merging with Lane D):

- `accounts.register` requires a verified Auth0 identity. Linking a phone additionally requires that phone's persisted signed JOIN challenge. Existing onboarding identity is retained; a different app identity cannot take it over. Link before creating event ownership/roles; no silent cross-account migration.
- Creating an event gives its app owner an organizer membership with notifications disabled. Only its own self-issued event JOIN adds messaging consent; app sign-in/contact selection is insufficient.
- Cache canonical domain decisions/results independently of worker completion. Atomic audit request keys deduplicate creates/cancellations and bind each YES/NO to one offer. Reject replies older than the proposal. No direct commit from an interpretation of a third party's acceptance.
- Event confirmation bumps the event version; commitment/task changes bump only the task. Remaining assignment offers for a multi-person task can advance to the new task version only while a slot remains and the already accepted change is compatible. Capacity-one competing offers become superseded.
- Unknown availability may justify a pending offer requiring approvals, never an invented availability fact or commitment. Planner recommends one candidate, requires organizer approval before contacting them, then the candidate's own YES.
- Multi-assignee task changes create one snapshot-bound offer per current assignee and apply once only after every approval. No change on a decline; dependencies/conflicts are rechecked before application.
- Authenticated seed creates labeled simulation drafts, unassigned tasks and invited fake contacts through the same public validation; it fabricates no live phone verification, consent or acceptance. Manual real setup uses `scripts/domain-setup.mjs` with a genuine app ID token, never a CLI identity override.

Contract impact: additive app account/organizer-opt-in/approval APIs, internal expiry/planner APIs, derived optional read labels, two optional job execution-cache fields, and audit `by_source`. Existing signatures/enums preserved. A/B integration is tested locally; separate A/C/D acknowledgments have not been collected and remain required before merging.

### ADR-019 — Scoped queue and constrained local Claude/Codex worker

- Date: 2026-10-10
- State: DECIDED for local implementation and development deployment; Codex entitlement/model inference/heartbeat verified. Live enrolled message flow and Claude entitlement remain VERIFY.
- Context: Photon and Convex already exist in the team's Lane A setup. This checkout initially had no configuration and only bootstrap stubs. Read-only dashboards identified the Rally project and active shared development deployment; deploying those stubs over teammates' current code would remove their work.
- Decision: preserve the local AI work, fast-forward `lane-c/local-ai` to the merged `origin/main` (`b73fba8`), restore it and integrate with the actual Domain engine. The earlier T0 alternative and pre-update AI work remain in named stashes. Support both local CLI providers as the user requested. Use the existing encrypted envelope helper and consent-gated outbox. Keep all frozen public/internal function signatures and shared schemas.
- Queue: persist per-message idempotency, event/task snapshots and a 45-second HMAC-bound owner/attempt lease. Verify a server worker secret before every public worker operation, then recheck the sender's actual enrolled/consented scope and versions. Limit attempts to two and lifetime to 120 seconds; an additive internal scheduled expiry emits at most one static consent-checked fallback even with no worker. Invalid output, unsupported consequential actions, foreign events and member attempts at organizer actions fail closed. Member self-unavailability uses `self`, `me` or verified sender ID; names alone are not authority. Domain retains reference resolution, source acceptance, domain mutations, audit and notices.
- Runner: use installed Claude Code 2.1.263 through `spawn`, with no shell, no model tools, no MCP/Chrome/customizations/hooks, no persisted session, an isolated working directory and a narrow environment excluding backend/provider secrets. Cap inference at 30 seconds and input/output at 65,536 bytes. Use tsx 4.23.15 (npm version metadata checked and pinned) for the existing shared TypeScript imports. Back off idle polls to 30 seconds. Reject API-key billing; require explicit model configuration and subscription preflight.
- Subscription verification: Anthropic's [current plan guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), updated October 7, permits `claude -p` with subscription limits and describes additional monthly API credits for Max/Team. This is not unlimited usage or verified account entitlement. The [programmatic CLI docs](https://code.claude.com/docs/en/headless) describe print/JSON output and explain that bare mode skips OAuth; the subscription runner therefore uses safe/restricted mode instead. Installed help and a help-only flag probe verify the local CLI options without inference. Local auth/preflight report unavailable; API key absent. Live model ID, latency and rate limits remain unmeasured.
- Alternatives: Agent SDK (deferred; CLI is already installed and provides verified controls); API-key inference (requires explicit separate billing authorization); persistent Claude conversations (rejected for minimal context and retention); model access to computer tools (rejected). A typed failure payload for completion would improve diagnostics, but changing the frozen public contract is deferred; the worker currently submits invalid JSON on inference failure and records sanitized heartbeat categories.
- Operations: `worker:configure` binds to an explicit matching development deployment, preserves existing server credentials, and creates an absent credential through a private file without secret argv; server write conflicts fail without `--force`. Read back before local atomic save. `worker:status` reports bounded aggregates only. The integrated backend deploy and active Codex heartbeat passed on 2026-10-10; real event membership remains absent. See [evidence](22-local-ai-evidence.md).
- Organizer CLI login: user chose the authenticated CLI setup. Add an operator-only browser PKCE helper for the existing Auth0 Native app. Validate returned RS256 ID tokens with pinned `jose` 6.2.12, issuer/audience/nonce/time checks; retain only the short-lived ID token in ignored mode-0600 local configuration. No dashboard/CLI identity override or fake phone proof. The required loopback callback is currently rejected; user must configure it and personally sign in. Auth0's [PKCE flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce/add-login-using-the-authorization-code-flow-with-pkce) and [validation guidance](https://auth0.com/docs/secure/tokens/id-tokens/validate-id-tokens) were checked against this implementation.
- Codex: this Mac is already logged in using ChatGPT. CLI 0.152.1 supports ignored user configuration/rules and ephemeral execution. Disable shell, apps, plugins, hooks, browser/computer, images, skills search, agent delegation and web/MCP access; read-only sandbox and never-approve are additional defenses. Reject API keys. Pin the inspected CLI version in preflight; re-review capabilities before accepting an upgrade. The live account catalogue, rather than a stale local cache, supplied `gpt-5.6-luna`. See the official [configuration reference](https://developers.openai.com/codex/config-reference) and [noninteractive mode](https://developers.openai.com/codex/noninteractive).
- Protocol verification: real CLI output includes a startup notice that Code mode fails closed because its host is disabled. Accept only that exact 0.152.1 notice before a turn, retain capability disabling, and reject every other error/tool item. A regression test covers both cases; no general error suppression.
- Domain integration: allow member assignment suggestions to reach the existing organizer-approval workflow. Normalize `self`/`me` to the server-verified sender ID. Tests cover signed input through actual Domain, pending offer, target acceptance, duplicate completion and self-cancellation, using fake delivery and scripted decisions. Queue unit tests retain explicit Domain doubles.
- Evidence: current commands, test counts, evaluation and live blockers are recorded in `16`; the AI branch is not deployed and no new Photon message was sent.

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
