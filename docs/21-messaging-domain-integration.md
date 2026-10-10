# Lane A–B integration verification

Date: 2026-10-10. Goal: prove that signed inbound routing, consent, deterministic domain transitions and outbox delivery work together without a model, rather than only passing isolated lane tests.

## Integration harness

`tests/integration/messaging-domain.test.ts` runs **13 simulations** against the actual HTTP handler, Spectrum verification/component, encrypted inbox, scheduler, command router, Auth0-facing account APIs, invitations, event/task APIs, proposals, commitments, scoped status and outbox claim/settlement. Its only runtime replacement is the external Spectrum sender boundary, which calls the real `deliverWithAdapter` through `FakeMessagingAdapter`. App identities, webhook payloads, signing/encryption keys and `+1555…` phones are fixtures. **No actual Photon message, real Auth0 login or Claude invocation is represented by this harness.**

Setup registers an app organizer, verifies a synthetic phone JOIN, creates/confirms an event/task through public APIs, and redeems genuine fixture invitations through signed HTTP input and scheduled routing. Selecting contacts produces no send. The initial assignee accepts an actual fixture proposal; no commitment is directly seeded. Since Lane C remains absent, proposals are created explicitly through the internal domain API using the stored signed fixture request as evidence. This is labeled **simulated manual setup**, not natural-language interpretation.

The scheduler drains only due jobs between steps, preserving TTL/watchdog timing. Tests assert no scheduled job failures and provider-accepted fake sends have one attempt/provider ID.

| Verified path | Result |
|---|---|
| JOIN → request → YES → STATUS | Old assignee stays active until target YES; exactly one request and three affected-person notices; status reflects the committed winner |
| Duplicate signed YES webhook / another YES | One inbox row for the provider ID, no duplicate commitment or business notices; a new YES without an offer gets truthful fixed copy |
| NO | Prior assignment preserved; one decline notice each to organizer/target |
| STOP / LEAVE | Pending offers canceled within the command transaction; existing commitments preserved |
| STOP → immediate RESUME → YES | Canceled offer cannot revive; no delayed cancellation job fails |
| STOP before queued request dispatch | Request becomes failed with zero attempts; fake provider never receives it |
| PAUSE → YES → RESUME → YES | Paused reply does not accept; consent survives; explicit resumed acceptance commits once |
| Stale task version / expired offer beside one current offer | Current offer is selected; old offer never commits or causes false ambiguity |
| Two valid offers | Clarification reply, no commitment change |
| Scheduled expiry / repeated expiry | Assignment unchanged; terminal notices emitted once |
| Member suggestion → app organizer approval → target YES | Candidate not contacted before organizer approval; repeated approval sends once; approval never substitutes for target acceptance |
| STATUS before/after organizer approval | “Awaiting organizer approval” changes to “awaiting response”; current assignment remains visibly confirmed |
| STATUS with an unrelated private event | Only enrolled-event data rendered; private app query denied |

## Fixes and changed files

- `convex/identity.ts`: STOP calls `internal.proposals.cancelForUser` in the same mutation after withdrawing messaging permission. A later RESUME cannot race the cancellation.
- `convex/commands.ts`: LEAVE likewise cancels its scoped proposals transactionally. YES/NO counts current snapshot-valid offers; a stale row waiting for expiry no longer hides a valid offer. One sole stale offer still reaches the domain for a truthful expiry response.
- `packages/shared/copy.ts`: shared `pendingCounts` distinguishes pending organizer approval from pending participant acceptance. The status-copy schema adds optional `approvalCount`; old callers remain valid.
- `convex/lib/decisionEngine.ts`: structured worker status uses the same count/render logic as deterministic STATUS.
- `convex/{domain,messaging}.test.ts`: assertions reflect atomic cancellation rather than manually invoking a deferred job.
- `tests/integration/messaging-domain.test.ts`: signed full-pipeline tests above. README, INDEX and decision/evidence docs updated.

No persisted enums, tables or public/internal function signatures changed in this follow-up. `approvalCount` is an additive optional shared copy-input field, affecting A/B/C callers. Separate lane acknowledgments have not been collected; the existing contract-review requirement before merging still applies. No merge occurred.

## Acceptance evidence

The original baseline passed 160 tests. New failing regressions reproduced the delayed STOP/LEAVE cancellation, the stale-offer ambiguity and incorrect organizer-approval status copy before fixes.

```text
npm run check
  strict root/Convex, shared and worker typechecks: passed
  Test Files  11 passed (11)
       Tests  173 passed (173)
```

Deployment succeeded at **5:18:04 PM EDT** on `calebhantech:rally:dev/caleb-han` (`calm-jackal-984`) using `npx convex dev --once --typecheck enable --tail-logs disable`. Code generation and cloud typechecking succeeded. Subsequent checks returned:

```text
spectrum:checkRuntime: cryptoReady=true, missingConfiguration=[]
events.myEvents: anonymous public access denied
Unsigned /spectrum/webhook: HTTP 400, rejected
npm run contracts:list: 38 registered functions
git diff --check: passed
```

The cloud crypto check is a **synthetic self-check**, not a Photon send. No simulation fixture or fake consent was written to the live deployment. Existing real HELP/onboarding transport evidence remains in `19-messaging-evidence.md`. The **separate live M1 gate** still needs actual selected participants to JOIN and the target's real Photon YES; these simulations do not replace that trace. Genuine app login has not been observed, and Lane C free-text reasoning remains unimplemented.

## Combined merge validation

On 2026-10-10 the user requested Lane D → `main`, then `git pull`, then A/B integration for M1. Lane D (`48335d7`) was merged as `eabd550`; `git pull --ff-only origin main` completed immediately afterward and the merge was pushed. Lane B (`77c8f0c`) already includes Lane A (`63bb5c5`), so merging B preserves both lanes. The only merge conflict was the duplicate ADR-017 identifier: both decisions were retained, with B's decision renumbered ADR-018.

Independent review checked A/B messaging/domain paths and compatibility with the Swift adapter and Lane C stubs. Existing client signatures remain unchanged; optional read labels, copy input and execution-cache fields are additive. This is integration review under the user's merge authorization, not an assertion that the original lane owners separately acknowledged changes. Historical acknowledgment requests above describe their pre-merge handoff.

`npm ci && npm run check` passed separately for Lane D (64 tests), A/B (173 tests), and the combined D+A/B tree (173 tests in 11 files, including all 13 signed pipeline simulations). Root/shared/worker strict typechecks passed; `npm run contracts:list` reported 38 functions; `git diff --check` passed. Installed packages match the lockfile (`npm ls --depth=0`). Lane D's merge also passed GitHub Actions. No provider or model call is part of these tests. The live M1 run is deferred at the user's request; no new live trace, deployment or messaging consent is claimed.

The unchanged iOS source passed `./scripts/test-simulator.sh <booted-simulator-UDID>` end to end from a clean Lane D checkout on Xcode 27.0 / iOS 26.2. Build succeeded; all 16 Core/Live unit tests and all five UI tests passed with zero failures. No local app configuration was copied into that checkout. See the [app verification record](../ios/Rally/README.md#verification-record--2026-10-10).

The M1 prompt now uses the authenticated setup script rather than the simulation seed, requires persisted originator evidence/current versions, establishes initial assignments by real acceptance, and separates the NO scenario from the already-accepted task. Two phones can exercise organizer-to-participant reassignment; the canonical separate Alex/Maya/Jordan roles need three real consenting participants.

The iOS adapter still needs registration before protected queries, phone linking before event ownership, task windows (required for assignment eligibility), draft confirmation and organizer event JOIN. These are documented M2 follow-ups, not implied by the backend merge. Unknown Photon delivery outcomes still require reconciliation; no provider receipt or exactly-once external delivery guarantee was added.
