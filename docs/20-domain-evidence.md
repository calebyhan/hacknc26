# Lane B domain engine and evidence

Goal: participants can approve or decline task offers through the existing iMessage command router; only verified acceptance changes committed assignments. Organizers create events/tasks through authenticated APIs, and each participant's status is limited to their events. Cancellation leaves an honest coverage gap. These behaviors work without a model.

Integration follow-up: **173 tests in 11 files pass**, including 13 signed HTTP/scheduler/outbox pipeline simulations. STOP/LEAVE cancellation is now atomic, stale offers do not hide current ones, and status distinguishes organizer approval from participant response. The initial Lane B evidence below is retained; latest details are in [A+B integration evidence](21-messaging-domain-integration.md).

## Acceptance evidence

All domain scenarios below are **simulations** using `convex-test`, encrypted synthetic Spectrum messages, fake `+1555…` phones, and `FakeMessagingAdapter`. No Claude invocation or real Photon send is part of these tests. The simulated sender's persisted message is checked inside the actual domain mutation; supplying an actor ID alone is insufficient.

```text
npm run check
  strict root/Convex, shared and worker typechecks: passed
  Test Files  10 passed (10)
       Tests  160 passed (160)
```

| Scenario | Evidence in source |
|---|---|
| ST-04/05/07: pending preserves Maya; Jordan YES releases Maya and commits Jordan exactly once | `convex/domain.test.ts`; repeated create/response returns the same result; exactly four outbox rows (request plus one notice each to organizer/new/old assignee), four fake sends |
| ST-06/09: NO, equivocal text, wrong sender | Same test file; no new commitment; existing assignee retained |
| ST-08: event version, task version, expiry; new conflicts at acceptance | Same test file; stale offer closes, conflict cannot overwrite assignment |
| ST-13: concurrent accepts for capacity one | Two mutation calls via `Promise.all`; one active winner, accepted/superseded offers |
| Capacity two | Two accepts remain valid across their own task version updates; a third offer becomes superseded |
| ST-18: self-cancel, audited organizer override, forbidden third-party report | Self becomes `canceled_by_participant`; organizer release becomes `released`; declines keep `needs_coverage`; duplicate cancellation emits no second notice |
| ST-10/17: app authentication, membership/role, unknown-event privacy | Outsider, invited user and nonexistent event all fail with `UNAUTHORIZED`; status omits phones/auth subjects and unrelated events |
| ST-11: worker absent | Actual `commands.route` handles YES and STATUS; no reasoning job created |
| Multi-person changes | Location stays unchanged after the first approval; all active assignees must reconfirm; one NO prevents application; time changes cannot break dependent task windows |
| Model output is untrusted | Strict action schema, scope, lease, event/task snapshots, exact person/task refs and per-action permissions checked; later failure rolls back earlier actions; replay cached once |
| Acceptance evidence | A YES older than the proposal cannot approve it; one stored YES/NO cannot authorize multiple proposals; model self-commitment requires the sender's explicit, unequivocal offer |
| Auth0 identity and phone proof | `convex/accounts.test.ts`: anonymous rejected, no fabricated verification, wrong phone/reused identity rejected, existing HELP identity linked only after actual challenge proof, organizer JOIN adds event-specific consent |
| Planner | `packages/shared/tests/planner.test.ts`: consent/skills/conflicts/dependencies, explicit versus unknown availability, stable ID ties, no match, event-only obligations and dependency closure |
| Planner approval | `convex/domain.test.ts`: no-match leaves gap/no proposal; recommendations notify organizers first and never contact the candidate before approval |
| Seed | Same test file: authenticated, idempotent, two labeled simulation drafts; invited fake contacts, unassigned tasks, no fake consent/acceptance or outbound sends |

Additional checks: installed Convex 1.46.0 AuthConfig and ConvexHttpClient interfaces inspected; generated bindings refreshed with `npm run convex:codegen`; `npm run contracts:list` reports **38 registered functions**; setup script help/syntax passes; `git diff --check` passes.

Cloud development deployment succeeded on 2026-10-10 at 4:57:39 PM EDT with `npx convex dev --once --typecheck enable --tail-logs disable`, targeting teammate `calebhantech:rally:dev/caleb-han` (`calm-jackal-984`). Direct public HTTP client checks reject anonymous `events.myEvents`, anonymous `accounts.register`, and a forged app token. No user record is created by those denial checks. `spectrum:checkRuntime` returns `cryptoReady:true, missingConfiguration:[]`; this is a **synthetic, write-free crypto self-check**, not a new Photon delivery. Auth0 issuer/JWKS origins match and the live JWKS contains RSA signing keys. No simulation seed, real event change, provider send or model invocation was performed during this deployment verification.

## Auth0 and manual event setup

The user selected Auth0 and saved `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID` on Convex `rally:dev/caleb-han` (`calm-jackal-984`). Both values are present; the HTTPS discovery document's issuer/JWKS match the tenant. This verifies configuration/discovery, **not a successful real app login**. Convex verifies app tokens against this issuer/application. See [Convex's Auth0 setup](https://docs.convex.dev/auth/auth0).

Use the app's existing Auth0 login/session. For setup without the iOS app, `scripts/domain-setup.mjs` calls the same public authenticated APIs using that session's ID token, with no administrator identity override. Put `CONVEX_URL` and the short-lived `RALLY_AUTH0_ID_TOKEN` in private `.env.local`; never send the token in chat, save it in Convex, or commit it. Write operation arguments in gitignored `*.local.json` files. This is **manual setup before the demo**, not an autonomous agent action.

```sh
npm run domain:setup -- help
npm run domain:setup -- register register.local.json
npm run domain:setup -- begin-phone-link phone.local.json
```

Registration arguments: `{ "displayName": "Your name" }`. Phone-link arguments: `{ "phoneE164": "+<your actual E.164 number>", "idempotencyKey": "phone-link-1" }`. From that phone, text the returned `JOIN <code>` to Rally, then run `complete-phone-link` with `{ "invitationId": "<returned ID>" }`. Link **before creating events**, particularly if the phone has already sent HELP: its existing canonical identity is retained, never silently migrated into an unrelated account.

Then use these operations, each with an arguments file:

| Operation | Arguments / effect |
|---|---|
| `create-event` | `title`, `kind:event`, Unix-millisecond `startsAt`, valid IANA `timezone`, optional `location`, `idempotencyKey`; returns a draft event owned by the signed-in organizer |
| `create-task` | `eventId`, `title`, paired `windowStart`/`windowEnd`, `expectedEventVersion:1`, `idempotencyKey`; optional skills/capacity/dependencies |
| `confirm-event` | `eventId`, `expectedVersion:1`; scheduled event version becomes 2; task versions remain 1 |
| `organizer-invitation` | `eventId`, `idempotencyKey`; organizer texts its own returned JOIN code to opt in for this event |
| `invite-contacts` | `eventId`, `contacts:[{displayName,phoneE164}]`, `idempotencyKey`; only explicitly selected contacts, returns codes, **sends nothing**; share through a user-initiated channel and have each person JOIN |
| `approve-proposal` | `proposalId`; verified organizer approval enables contacting candidate; it does not accept on their behalf |
| `status` / `detail` | No args / `{eventId}`; enrolled-event read models, with committed and pending state separate |

`seed.bootstrap` remains internal and requires an authenticated user context. Its fixture is explicitly `[Simulation]`; it uses the same public creation/invitation mutations. Unlike the pure fixture, seeded tasks are unassigned and fake invitees remain invited. Never run a CLI identity override to represent an actual organizer's login or use the seed as evidence of real consent. The setup script uses actual session authentication instead.

## Changes and integration contracts

Domain/auth: `convex/{accounts,auth.config,events,tasks,proposals,commitments,domain,seed}.ts`, `convex/lib/{auth,domain,proposalEngine,commitmentEngine,decisionEngine,validators}.ts`. Shared: `packages/shared/{domain,planner,assignment}.ts`. Tests: `convex/{domain,accounts,messaging,stubs}.test.ts`, `packages/shared/tests/planner.test.ts`, `tests/contracts/inventory.test.ts`. Setup/docs: `scripts/domain-setup.mjs`, package scripts, `.env.example`, `.gitignore`, README, INDEX, data model, decisions and this evidence file. Generated API definitions refreshed.

All frozen function arguments/returns and persisted enums are preserved. Additive contracts:

- Public `accounts.register`, `accounts.beginPhoneLink`, `accounts.completePhoneLink`; public `events.organizerInvitation` and `proposals.approve`; internal `proposals.expire` and `proposals.recommendReplacement`.
- Optional `displayLabel` fields on task/member/proposal read models, derived from canonical state; no labels persisted. Expired/version-stale pending offers are presented as expired without a query writing state.
- Optional `reasoningJobs.executedDecisionJson` and `executionResultJson`, separate from Lane C's worker result; `auditEvents.by_source` for transactional request/response idempotency.
- Shared runtime create-input/display schemas and the existing planner/assignment contract implementations.
- Lane A integration: `invitations.redeem` permits an already enrolled **app organizer lacking consent** to redeem only its own self-issued organizer invitation. All other JOIN/role/opt-out checks remain. Its regression is in `accounts.test.ts`. The old status-stub fallback test now explicitly injects a simulated outage so fallback remains covered with a working domain.

Affected lanes: A (organizer opt-in/read models), C (job execution cache/planner), D (Auth0/phone-link/setup/read models). A/B integration has test evidence in this checkout. **No separate lane acknowledgments have been collected; obtain affected-lane contract review before merging.** No merge or production release is part of this task.

## Remaining live checkpoint

Lane B's prompt exit criterion is the passing deterministic simulation suite. **M1's separate real two-phone reassignment gate remains pending.** No real event membership, task commitment or acceptance was fabricated or seeded during implementation. Existing live HELP/onboarding evidence is in `19`. Lane C subsequently deployed the scoped queue/context and started this Mac's constrained Codex worker; its current evidence and new Auth0 CLI login helper are in [22](22-local-ai-evidence.md).

Before claiming M1, use genuine app authentication and phone proof, create the actual event/tasks/invitations, have opted-in participants JOIN, verify enrolled STATUS, then run `prompts/m1-messaging-domain.md` with an actual proposal and actual target YES. At the original Lane B checkpoint, free-text interpretation/worker/context were stubs; these now have separate Lane C implementation evidence in `22`. Weather remains deferred. Cross-person and planner organizer approval has a verified app API and remains distinct from the target participant's acceptance.
