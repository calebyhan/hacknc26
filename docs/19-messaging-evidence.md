# Lane A messaging evidence and setup

Date: 2026-10-10. **Goal:** a participant-initiated DM reaches a durable inbox, can enroll through JOIN, and receives consent-checked replies. **T0's real inbound/reply smoke test passes; live JOIN and M1 remain incomplete.** Local tests cover invitation and routing behavior with simulation. See the real transport trace below for the narrower live evidence.

## Implementation

- Native HMAC/timestamp verification uses the installed component's `parseWebhook` and `headerRecord`. Only inbound iMessage text DMs with E.164 sender metadata enter Rally. Outgoing messages, groups, signals and other content are ignored. A body-supplied name/phone never supplies identity.
- The registered Spectrum component retains verified routing metadata and redacted content with `triggersTurn=false`. Rally stores an AES-GCM encrypted minimized envelope before returning HTTP 200 and schedules per-message routing in the insertion transaction. Both durable writes deduplicate individually; if either fails HTTP returns 503 so redelivery can finish. Component `handled` is not proof of a Rally reply. Approvals are never batched.
- Invitation creation verifies actual app identity and enrolled organizer role locally, while Lane B's auth helpers remain stubs. It creates invited memberships without any send or verified phone assignment. Codes are unpredictable 128-bit HMAC outputs under a server-generated 256-bit secret, scoped to organizer/event/request key/phone; only SHA-256 hashes persist. Exact per-contact retries return the same code. TTL: 24 hours. Lockout: five wrong-sender attempts. Per-sender recent inbound count caps JOIN attempts. Unknown hashes cannot increment an unidentified invitation. Changed contact batches have per-contact, not whole-batch, idempotency; use fresh request keys for changed selections.
- JOIN validates the selected phone and actual persisted command, records event-scoped consent, and preserves STOP/PAUSE. Onboarding before JOIN can reuse the proven sender identity without duplicate phone mappings. App phone linking without a pre-bound selected/verified phone fails closed; the app-auth lane still needs its challenge flow.
- STOP/PAUSE block queued sends. STOP and LEAVE schedule Lane B's `proposals.cancelForUser`, which remains a stub: proposal cancellation is not verified end to end. LEAVE revokes one membership and notifies a consented organizer. Organizers must transfer responsibility before leaving; that transfer workflow is not available. Already dispatched external work cannot be recalled by opt-out.
- Every send passes `outbox.enqueue` and a second consent check at dispatch: active preference, enrolled event membership, actual inbound consent evidence and notification preference. The direct-reply exemption permits only fixed onboarding/help/invalid-invitation/control/verified-LEAVE copy. It cannot carry arbitrary private event data. Logical keys deduplicate; conflicting payload reuse fails.
- The Node sender calls the real `createCloudSender().deliver` API through `MessagingAdapter`. States remain `queued → sending → sent|failed|unknown`. A watchdog holds abandoned sends as unknown; late provider acceptance can settle that attempt. There is no automatic resend of failed/unknown rows; operator reconciliation is required before future retry support. There is no delivered-receipt support, so nothing marks delivered.
- YES/NO route only the verified target's single pending offer. Multiple offers ask for clarification. STATUS renders structured authorized domain output; cross-event output is rejected. UNKNOWN queues a versioned Lane C job only after selecting a permitted event; multiple events without a valid focus ask which event. Equivocal replies with a pending offer ask for YES/NO. B/C failures produce truthful unavailable copy without commitments or claims that review was queued.

## SDK verification and differences from proposed docs

Pinned and source/declaration inspected: Convex 1.46.0; `@spectrum-ts/convex` 0.1.1; core/iMessage 12.10.1; advanced-imessage 2.2.0; nice-grpc 2.1.17; nice-grpc-common 2.0.4; grpc-js 1.14.6. References: [official component source](https://github.com/photon-hq/spectrum-convex), [Photon announcement](https://photon.codes/blog/your-convex-agent-can-text-now-using-photon).

1. The component defaults to immediate turns; collapse/debounce is optional. Rally reuses its native verifier and redacted routing registry with a separate encrypted inbox/per-message scheduler instead of `registerRoutes`' batch pipeline.
2. `spectrum.send` means queued, not provider accepted. Rally's own outbox invokes the official sender directly, avoiding automatic ambiguous-outcome retries.
3. The deterministic component `clientGuid` is **not forwarded to the provider**; exactly-once external delivery is not guaranteed. SDK `ok=false` lacks a reliable failure/timeout taxonomy, so Rally conservatively holds these results as unknown.
4. Sending requires optional iMessage/gRPC peers, external-package configuration and static references. `spectrumSender.ts` supplies the references; `convex.json` targets cloud Node 24. The real HELP round trip verifies the deployed sender and one managed DM path. Only text DMs are supported; two-phone assignment and group access remain unverified.
5. Spectrum declares TypeScript 5/6 peers; Rally retains its checked TypeScript 7 pin. `.npmrc` records legacy peer resolution, and core/Vite are explicit dependencies so `npm ci` restores required peers. Strict checks pass.
6. Authenticated component codegen now succeeds. `spectrum.ts` uses generated `components.spectrum`, and outbox scheduling uses generated `internal.spectrumSender.deliver`; the temporary runtime casts/string references were removed. Deployment targeting and live traffic remain separate checks.
7. `npm audit` reports 14 moderate findings through Photon's OpenTelemetry chain, rooted in [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf), without compatible automatic fixes for the Photon packages. No arbitrary override was applied; assess upstream updates before production.
8. Photon's [documented native delivery](https://photon.codes/docs/webhooks/events) uses platform `iMessage`, while initial synthetic fixtures used `imessage`. The shared ingress schema now accepts both exact spellings and continues rejecting other platforms. A signed regression fixture with `event: "messages"`, a shared line and the documented spelling failed before the fix and passes afterward. This fixture is synthetic, not a live phone trace.

## Acceptance evidence

`npm run check`: strict root/Convex/shared/worker typechecks and **99 tests in 7 files passed**, using Node 26.0.0 and npm 11.10.1. Default shell Node 22 fails the repository engine constraint; verification used Node 26 without changing that constraint.

Final clean-install evidence: `npm ci` succeeded; `npm run check` passed again; `npm run contracts:list` reported 29 registered functions with existing visibility intact; `git diff --check` passed. `npm run messaging:configure` failed closed on missing local Convex authentication, printing no secret values. Work remains on the existing `lane-a` branch.

- **ST-01/A6:** unknown STATUS returns onboarding once, even when routed twice.
- **ST-02/A9:** invited contacts receive zero outbound; invitation creation never sends.
- **ST-07/A7 transport portion:** duplicate provider IDs create one inbox row and one schedule. This does not prove domain acceptance races/commits.
- Signed **synthetic** webhook persists before 200; forged signatures rejected; outgoing/group/read/spoofed-name input ignored; consecutive YES/question messages remain separate.
- Real Convex mutations in `convex-test` verify organizer authorization, hashed-code retries, wrong sender, expiry, replay, attempt lockout, onboarding-before-JOIN, STOP/PAUSE/RESUME/LEAVE and direct-reply bypass rejection.
- **FakeMessagingAdapter** verifies success/failure/timeout attempts occur once, unknown is held, dispatch rechecks opt-out and key conflicts fail.
- Explicit **Lane B test doubles** verify STATUS rendering/privacy and YES/NO routing. This is not ST-17 against actual domain implementation.
- An explicit **Lane C test double** verifies one queued job/acknowledgement and equivocal-reply handling. No model or real recipient is invoked.

At the initial local-only checkpoint, no cloud deployment, real inbound/outbound, phone receipt, live reassignment trace or group entitlement was verified. The local CLI returned `401 MissingAccessToken`. The user reports Photon phone configured; this is setup information, not transport evidence. The authenticated follow-up below supersedes the deployment/authentication blockers.

### Authentication follow-up

Local Convex access now succeeds. `npx convex deployment select rally:dev/caleb-han` resolves to `calebhantech:rally:dev/caleb-han`, deployment `calm-jackal-984`, which this checkout already referenced. This is the teammate's requested development deployment; the earlier assumption that it was a different personal deployment was incorrect. Authenticated `npm run convex:codegen` and `npx convex dev --once` succeeded there. `SPECTRUM_PROJECT_ID` is set to the supplied project ID and a server-only `RALLY_MESSAGING_KEY` was generated without printing its value.

`npm run check` now passes **100 tests**, including a synthetic action-to-mutation encryption/HMAC self-check with no database writes or provider sends. The two internal self-check endpoints add no public access. Actual cloud execution of `npx convex run spectrum:checkRuntime '{}'` returned `cryptoReady: true`, with missing configuration names `SPECTRUM_PROJECT_SECRET` and `SPECTRUM_WEBHOOK_SECRET`. This verifies action encryption and mutation decryption/HMAC/hash support, not provider sending. Real transport is still pending.

After the user saved the two secrets, `npm run messaging:configure` succeeded and preserved the existing key. The cloud self-check returned `cryptoReady: true, missingConfiguration: []`. An authenticated Photon webhook-list request succeeded and found exactly one registration matching `https://calm-jackal-984.convex.site/spectrum/webhook`; no secret values were printed. An unsigned empty JSON POST to that endpoint returned HTTP 400. Registration and configuration presence do not prove the saved signing secret matches the registration; a genuine signed delivery is still required.

Following the platform spelling fix, `npm run check` passed **101 tests in 7 files** and `npx convex dev --once` redeployed successfully. `npm run contracts:list` reports **31 registered functions**, including the two internal diagnostics. The inbox/outbox were initially empty; the real transport follow-up below supersedes that earlier checkpoint.

### Real transport follow-up

On 2026-10-10, the user initiated a HELP message from their connected phone. Read-only inspection of `dev/caleb-han` found two real inbox rows in `processed` state and two matching outbox rows in `sent` state, each with one attempt and a provider message ID. Decryption was performed in memory only to identify the exact HELP message; neither plaintext, contacts, routing identifiers nor secrets were printed. One row was the HELP command, with the exact static command-list reply. The user then explicitly confirmed receiving that reply in Messages.

Trace references below are the first 12 hex characters of SHA-256 of each database row ID. No real phone numbers or provider identifiers are included.

| Evidence | Sanitized trace | Result |
|---|---|---|
| Real HELP inbound, October 10 at 3:59:54 PM EDT | `6e6a6224e06b` | Durable encrypted inbox; `processed` |
| Its command-list reply | `f2c84e71ef10` | `sent`, attempt count 1, provider ID present |
| Phone observation | User confirmation in chat | Command-list reply received |
| Constructed signed replay of the real HELP ID | Same inbound trace | HTTP 200; one inbox row, one reply, zero new outbox rows |
| Real unknown-user STATUS, October 10 at 4:01:21 PM EDT | `80b9502b057a` | `processed`; no enrolled-event data requested |
| Its onboarding-only reply | `76ea13508bc5` | `sent`, attempt count 1, provider ID present, no event scope; user confirmed invitation instructions received |

The replay reconstructed a native payload from the stored minimized envelope and signed it with the configured secret. It is a **constructed replay**, not a Photon-generated retry and not a second participant message. This verifies endpoint deduplication for that ID; it does not establish exactly-once delivery under ambiguous external outcomes. The real original delivery verifies the native signature configuration and the Node/gRPC sender path. Outbox state remains `sent`, not `delivered`: user-observed receipt does not create provider delivery-receipt support.

T0's real receive-and-reply gate now passes. Live JOIN, enrolled event STATUS, reassignment and cancellation still await genuine organizer/authenticated event setup and Lane B integration. No real event consent was seeded, and no domain state transition is claimed.

Lane A handoff: implementation and local simulation checks are ready for integration, and the real unknown-user onboarding portion (A6/ST-01) now passes. The lane prompt's complete live exit criterion is not met until an actual selected invitee redeems JOIN and an enrolled participant receives authorized event STATUS. Unknown-user invitation instructions do not satisfy enrolled-event status or ST-17. Organizer identity/event setup and the actual `domain.statusFor` implementation remain Lane B blockers.

## Finish the live smoke test

1. Confirm the intended project/development deployment before future setup. The current checkout is authenticated and selects `rally:dev/caleb-han` (`calm-jackal-984`). Photon secrets, webhook URL and deployed code must refer to the same one.
2. Save `SPECTRUM_PROJECT_SECRET` from Photon project Settings. In Photon **Webhooks → + Add webhook**, register `https://calm-jackal-984.convex.site/spectrum/webhook`; copy the signing secret shown once into Convex as `SPECTRUM_WEBHOOK_SECRET`. If this exact URL already exists, use the teammate's saved secret; a lost secret requires deleting and re-registering that webhook. [Official instructions](https://photon.codes/docs/webhooks/managing-webhooks). `SPECTRUM_PROJECT_ID` is already configured as `4dad8b60-5af7-483c-91fa-d9f806d7c63a`. Keep secret values out of chat/git.
3. Run `npm run messaging:configure`. It checks configuration without printing secrets and creates `RALLY_MESSAGING_KEY` if absent. Preserve the key: rotation makes stored envelopes unreadable and changes invitation-code derivation.
4. Run `npm run convex:codegen` and `npx convex dev --once` after code changes. Deployment, cloud AES-GCM/HMAC support and the real Node/gRPC HELP reply already pass.
   After configuration and deployment, `npx convex run spectrum:checkRuntime '{}'` verifies crypto in the action and mutation runtimes without writes or provider calls. This is a **synthetic self-check**, not Photon delivery evidence.
5. Configure Photon's **native JSON webhook**, not Fusor protobuf, at `https://<selected-deployment>.convex.site/spectrum/webhook` with its matching signing secret. Text HELP or STATUS in your provisioned Rally conversation. Unknown STATUS returns onboarding; HELP returns commands. Record actual inbound ID, outbound provider acceptance and phone receipt with numbers/content redacted in shared evidence.
6. Create genuine organizer/invitation setup through authorized mutations, redeem from the selected phone and replay a webhook. Actual event STATUS/proposal acceptance awaits Lane B. Never seed fake consent into real users or label unavailable-status copy as event status.
7. Save a sanitized trace here and in `14` before marking T0 complete; verify two phones' actual line assignments and group entitlements separately.

## Changed files and remaining boundaries

Code: `convex/{http,convex.config,spectrum,spectrumSender,inbound,outbox,invitations,identity,commands}.ts`, `convex/lib/{messaging,messagingDelivery}.ts`, `packages/shared/{commands,copy}.ts`. Tests: `convex/messaging.test.ts`, `packages/shared/tests/messaging.test.ts`; obsolete Lane A stub assertions and the internal endpoint inventory were updated. Setup: manifests/lockfile, `.npmrc`, `.env.example`, `convex.json`, `scripts/configure-messaging.mjs`. Docs: README, INDEX, `14`, this file.

Frozen schema/enums/adapters/fixtures, Lane B/C source and existing signatures are preserved. Additive internal outbox claim/settle/watchdog and Node sender registrations are inventoried; obtain the contract review described in `17` before merging them. No merge or production publication occurred.
