# M1–M3 automated preparation and demo handoff

Date: October 10, 2026 (America/New_York). Goal: make the integrated coordination flow repeatable and test its failure paths without requiring participant interaction during development.

**Local rehearsal is ready. The live M1/M2 gates, and therefore the final M3 release gate, remain open.** Simulated signed messages do not establish a person's actual consent. Real model evaluation on synthetic inputs does not establish live Photon coordination or app/device acceptance.

## Integrated source and fixes

`main` combines the A/B backend, D account/status continuation and C phone setup/worker branch (`6c4c444`). The five textual conflicts were README, event invitations, contact invitations, shared exports and the documentation index. Shared invitation helpers and app error wrappers are both preserved; all public signatures and canonical enums remain intact. D's ADR-019 is retained; C's colliding worker decision is now ADR-022.

Additional demo-path fixes:

- `convex/outbox.ts` rechecks pending state, reply deadline, event/task versions, recipient and organizer approval before claiming a queued offer. Stale requests become failed with zero attempts; acceptance, decline and expiry notices remain deliverable. Already dispatched external messages cannot be recalled.
- `convex/lib/proposalEngine.ts` puts the absolute reply deadline in the event timezone into participant and organizer requests. The default ten-minute offer window is unchanged.
- `packages/shared/copy.ts` and its authorized callers include an event ID when STATUS contains duplicate titles. LEAVE/ambiguity instructions explain how to distinguish events. Replaying one provider ID still differs from deliberately sending a new CREATE message.
- The Codex adapter accepts only inspected versions 0.152.1 and 0.160.1. Installed 0.160.1 previously failed preflight. Its exact restricted request was captured against a local rejecting mock: no tool definitions and no authentication header. Unknown versions still fail closed.

## Reproduce the local rehearsal

```sh
npm ci
npm run check
npm run demo:rehearse
npm run eval:fake
```

`demo:rehearse` needs no account, phone or provider credentials. It exercises the actual signed-webhook handler, encrypted inbox, scheduler, queue, worker loop, domain, outbox and authorized app queries. External delivery uses `FakeMessagingAdapter`; inference uses scripted `FakeInferenceProvider`; phone/app identities are fixtures. The output is explicitly marked SIMULATED.

The [saved simulation trace](../tests/integration/traces/rehearsal-simulated.json) records initial assignment, pending reassignment, target acceptance, replay, decline and worker outage with task/event versions and app-confirmed counts. It includes no phone numbers, invitation codes, raw messages or live IDs. Regenerate it from the `RALLY_SIMULATED_REHEARSAL` and `RALLY_SIMULATED_PRIVACY` JSON lines printed by the command. It is not `m1.md` or `m2.md`, which are reserved for actual live evidence.

For the visual fallback, run the existing iOS app and choose **Explore demo**. Label its phone proof/acceptance controls as local simulation. The unchanged Swift source previously passed 73 unit tests and eight UI tests in this session; the new rehearsal additionally checks that the integrated backend app reads agree with messaging/domain truth. This does not replace ST-15 on a real device.

## Acceptance evidence

- Combined strict TypeScript checks and **405 tests in 30 files passed**; one optional test/file skipped. The installed-CLI capability inventory has its own passing run; it skips in ordinary CI.
- `npm run contracts:list`: **46 registered functions**. No public privilege or frozen signature was broadened by conflict resolution.
- Regression tests reproduced stale-request sending and duplicate-title ambiguity before fixes. The dedicated outbox suite passes 23 cases.
- `npm run demo:rehearse`: both continuous integrated scenarios passed.
- Scripted evaluation: **23/23**. Real Codex inference on synthetic inputs: **23/23**, p50 **4,365 ms**, p95 **6,590 ms**. See [case results](../tests/eval/results/2026-10-10-m2-live.json) and [runtime audit](../tests/eval/results/2026-10-10-worker-audit.json). Most grades check scope/action types; the named-person case also checks references. These are not end-to-end live acceptance measurements.
- An initial evaluation preflight found missing local provider/model settings and made no inference call; it is retained separately. The successful run used the already established Codex/model selection. Public settings were then added to ignored local configuration without changing credentials.
- Local full-scenario runtime logs were captured and checked against all decrypted synthetic message bodies, phones, codes and fixture credentials; scoped inference packets passed unrelated-event canary checks. A bounded repository/history scan checked 205 text files and 417 reachable text blobs for common private-key/token patterns, with no matches. No locally configured secret values were available to compare in that scan. This is not a full secret detector or inspection of production logs.

| Scenario | Local evidence | Live boundary |
|---|---|---|
| ST-01 onboarding | `convex/messaging.test.ts` | Prior HELP/onboarding phone evidence recorded |
| ST-02 no cold outreach | Rehearsal + phone setup suite | Each actual participant must JOIN |
| ST-03 context/ambiguity | Shared context tests + rehearsal | Full live M2 ambiguity scenario open |
| ST-04–07 proposals/YES/NO/replay | Rehearsal + messaging/domain integration | Actual target YES/NO/reassignment/replay open |
| ST-08 stale state | Domain + outbox expiry suites | User observed expiry; late-YES live check open |
| ST-09 equivocal reply | Rehearsal + domain tests | No modeled acceptance permitted |
| ST-10 authorization | Account/domain/phone setup/app tests | Genuine app session/device verification open |
| ST-11 worker outage | Rehearsal: YES/STATUS and one scheduled fallback | Live outage drill open |
| ST-12 constrained inference | Schema/queue/context tests, rehearsal, real synthetic eval and no-tools inventory | Full live injection scenario open |
| ST-13 race | Concurrent domain acceptance test | On-record simulated capacity-one race passes |
| ST-15 app parity | Rehearsal checks authorized backend app reads; existing Swift suites | Actual iMessage-to-device update open |
| ST-16 privacy | Rehearsal packet/log assertions and limited static scan | Actual provider/backend log review open |
| ST-17 scoped status | Domain/messaging/rehearsal tests | User supplied enrolled STATUS receipt |
| ST-18 cancellation policy | Domain + reasoning/domain integration | Live cancellation/replacement drill open |

## Development runtime

At 22:35 EDT, `npx convex dev --once --typecheck enable --tail-logs disable` successfully deployed the integrated backend and these hardening changes to the verified `calm-jackal-984` development target. No production deployment, credential rotation, participant-data seeding or messaging-provider call was performed by the verification.

Post-deployment checks confirmed ready messaging crypto/configuration, rejection of an anonymous app query, rejection of an invalid worker token and HTTP 401 for a synthetic forged webhook. The existing Codex worker was online with no reported error and a 27-second heartbeat age. The sampled queue contained two completed jobs and zero queued/claimed/failed/expired jobs. This is sampled health, not new delivery or acceptance evidence. The existing worker was not stopped or duplicated. See the [sanitized development smoke results](../tests/integration/traces/development-smoke-2026-10-10.json).

## M3 scope decision

| P1/P2 item | Demo disposition |
|---|---|
| Cancellation/replacement planning | Demo-only with simulation label until its real acceptance loop is recorded |
| iOS setup/status/activity | Demo-only with simulation label until device/ST-15 acceptance |
| Weather/ST-14 | Cut; stub remains inactive, no simulated alert presented as live |
| Flyer extraction | Cut |
| Widget, calendar, extra integrations, casual/project mode | Cut |

The storyboard's optional final segment uses cancellation/decline or worker-outage recovery, not weather. No new feature work is needed for this rehearsal scope. Keep fixes focused on the end-to-end path. Main is the integrated demo source; older branch references are retained for history.

## Remaining real acceptance

1. Select one actual event by ID, verify its participants' own JOIN consent and create a fresh offer. The target must personally reply YES before the displayed deadline. Confirm the commitment, versions, STATUS and notices.
2. Establish a real initial assignment, then reassign it to another consenting participant. Verify release of the prior commitment, one accepted replacement, a separate NO and replay/repeated YES without duplicate business effects.
3. Exercise the real natural-language/ambiguity/cancellation/outage paths with the running worker, and match an actual iMessage YES to the signed-in iOS device (ST-15).
4. Save sanitized live M1/M2 traces and rehearse on the actual phones before declaring M3/demo-ready. T8's timed rehearsals, recording and final demo tag remain pending.

These checks cannot be satisfied by injecting messages that impersonate participants or writing commitments administratively. Until their evidence exists, the accurate claim is **automated rehearsal ready; live demo acceptance pending**.
