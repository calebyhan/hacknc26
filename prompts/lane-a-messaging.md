# Lane A — Messaging (Photon, inbox/outbox, invitations, commands)

You own everything between iMessage and the domain: Photon Spectrum integration, durable inbound, the outbox, invitation/JOIN, opt-out state, and the deterministic command router. Tickets **T0** and **T2**.

## Read first

1. `AGENTS.md`
2. `docs/04-messaging-and-photon.md` (all of it)
3. `docs/03-data-model.md` — `inboundMessages`, `outboundMessages`, `invitations`, `memberships`, `users.messagingState`, invariant 11
4. `docs/17-workstreams.md` — contract and ownership
5. `docs/10-security-privacy.md` — phone numbers and short codes

## You own

`convex/http.ts`, `convex/convex.config.ts`, `convex/{spectrum,inbound,outbox,invitations,identity,commands}.ts`, `packages/shared/{commands,copy}.ts`, and tests for them.

**Do not edit** Lane B/C files or the shared contract (`enums`, `agentDecision`, `contextPacket`, `adapters`, `fixtures`, `schema.ts`) except via a `contract:` PR.

## Step 0 (hour 0, before Prompt 0 lands)

Manual, no code: sign up at https://app.photon.codes/dashboard (try promo `HACKNC`, then `HACKWITHPHOTON`), connect iMessage, note the plan tier and how numbers are assigned for two test phones. Ask in the Photon Discord whether hackathon Pro includes group-chat API access. Record all of it in `docs/14-decisions-and-open-questions.md` (blocking Q1, ADR-012).

## Tasks, in order

1. **T0 provider smoke test.** Install and pin `@spectrum-ts/convex`; read its current README/source for the real registration and send API (do not trust pseudo-code in our docs). Configure `SPECTRUM_*` env vars server-side. Wire `http.ts` + `convex.config.ts`. Prove one real inbound DM is stored and one real reply is sent. Record the pinned version and any API differences in `14` (blocking Q2).
2. **`inbound.ingest`.** Persist by `(provider, providerMessageId)`; repeats are acknowledged with no side effects. Sender identity comes only from verified webhook metadata. Check the component's debounce/batching against `04`'s debounce caveat: a `YES` must never be merged with other text.
3. **`outbox.enqueue` + sender.** Single path for every outbound message. Enforce invariant 11 (consent + `messagingState`) inside the mutation. Idempotency key unique; states per `03` (`queued → sending → sent | failed | unknown`; `delivered` only with a receipt). Reconcile `unknown` before retrying. Use `MessagingAdapter` so tests run on `FakeMessagingAdapter`.
4. **`parseCommand`** in `packages/shared/commands.ts`: the command table in `04`. Case-insensitive, trims punctuation, `maybe`/`probably` are **not** `YES`.
5. **`invitations.createForContacts` / `invitations.redeem`.** Codes: cryptographically random, hashed at rest, single use, TTL, `failedAttempts` limit. Redeem marks invitation `redeemed`, membership `enrolled`, records `consentAt`/`consentSourceMessageId`. Creating invitations never sends anything.
6. **`identity.setMessagingState`.** `STOP`/`PAUSE`/`RESUME`. On `STOP`, cancel queued optional outbound and call `internal.proposals.cancelForUser` (Lane B; stub is fine until it lands). `LEAVE <event>` sets membership `left` and cancels that user's pending proposals in that event.
7. **`commands.route`.** Unknown sender → onboarding reply only (A6). `JOIN` → redeem. `YES`/`NO` → `internal.proposals.respond`. `STATUS` → `internal.domain.statusFor` then render with `copy.ts`. `HELP`. `UNKNOWN` text from an enrolled user → `internal.reasoningJobs.enqueue` (Lane C) plus at most one truthful "checking" acknowledgement. Calls into B/C stubs are expected to throw until those lanes merge; test routing with mocks.
8. **`copy.ts`.** Templates from `04` outbound examples. Input is structured state only.

## Tests you must make pass

ST-01 (A6), ST-02 (A9), ST-07 (A7), ST-17 (R9, once B's `statusFor` lands), plus T0/T2 ticket tests in `docs/16`: bad webhook signature rejected, invitation replay/expired/wrong sender, `STOP`/`PAUSE`/`RESUME`/`LEAVE`, outbox idempotency under retry, no outbound to `invited`/`stopped` users.

## Done when (for M1)

Real Photon: an unknown phone gets onboarding only; a seeded invitee texts `JOIN <code>` and becomes `enrolled`; `STATUS` replies; duplicate webhook replay produces no second reply. Evidence: test output + sanitized trace (no real numbers).

## Report

**Goal / Changed files / Acceptance evidence / Risks and open questions.** Call out every Spectrum behavior that differed from `04`.
