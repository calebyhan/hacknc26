# M1–M3 automated preparation and demo handoff

Date: October 10, 2026 (America/New_York). Goal: make the integrated coordination flow repeatable and test its failure paths without requiring participant interaction during development.

**Local rehearsal is ready. The live M1/M2 gates, and therefore the final M3 release gate, remain open.** Simulated signed messages do not establish a person's actual consent. Real model evaluation on synthetic inputs does not establish live Photon coordination or app/device acceptance.

## October 11 product review and follow-up

The read-only review of the latest **Rally Final 1012** run found real signed JOINs, organizer confirmation, task creation, two accepted assignments, organizer-approved reassignment, and release of the previous participant. The reviewed snapshot contained 19 inbound messages, 26 provider-accepted outbound messages, four completed reasoning jobs and no failed/unknown deliveries. Provider acceptance is not a phone delivery receipt. The speakers offer was still pending at the review snapshot; that snapshot is not current event state.

The principal defect was task ambiguity: a participant held setup while their most recent pending offer concerned speakers, and “cover for me instead” silently selected setup. Other problems were formatted phone rejection, opaque setup commands, STATUS counts without people, duplicated approval guidance, and model requests waiting roughly 21–27 seconds for worker pickup. Existing consent/organizer/participant checks did protect the actual assignment changes, but they did not make the interaction clear.

The follow-up implements and tests:

- Guided `create an event`, `invite someone` and `add a task`, local-time previews, formatted country-code phones, sender-bound `join <event name>` and friendly organizer approvals. Expert commands remain available.
- Team staffing in phone and iOS setup; STATUS lists confirmed people, filled/required places, pending people and deadlines. Explicit YES/NO task references resolve multiple offers without closing the others.
- Participant overlap warnings followed by separate signed confirmation. Repeating YES does not silently accept overlapping obligations. Compatible team offers survive another teammate accepting; final-place races remain atomic.
- Deterministic task clarification before model execution, a bounded signed follow-up choice, and a backend check that the model uses that exact task. Structured context now includes task windows, capacity, pending offers and recent focus. Synthetic evaluation checks exact task/person IDs for the added scenarios.
- Originator progress receipts, a two-second idle poll interval in the worker source, and silent iOS session restoration through the installed Auth0/Convex SDK. Polling changes require reloading the running worker; source tests alone are not runtime latency evidence.

These additions are a tested implementation, not a new real-phone rehearsal. The data-model/consent decision is [ADR-023](14-decisions-and-open-questions.md#adr-023--conversational-setup-team-staffing-and-explicit-overlap-consent). The sections below retain the earlier preparation evidence and should be read with this newer review.

Verification on the integrated October 11 source:

- `npm run check`: **483 passed, one optional test skipped**, all strict TypeScript checks passed; log `/tmp/rally-product-final-acceptance.log`. `npm run contracts:list` still reports **46 functions**. `git diff --check` passed.
- `npm run demo:rehearse`: both simulated full-pipeline/privacy scenarios passed. `npm run eval:fake`: **25/25** scripted cases.
- `npm run eval:live`: **24/25** on synthetic inputs, p50 **4,221 ms**, p95 **7,267 ms**. Both new exact task/person cases passed. Availability case 15 was rejected as `INVALID_DECISION`; no domain execution occurred. Its separate unchanged-model diagnostic passed, but the initial error's raw output was not retained, so its precise cause remains unknown. Preserve both the [full sweep](../tests/eval/results/2026-10-11-product-live.json) and [separate diagnostic](../tests/eval/results/2026-10-11-case15-diagnostic.json); this is not a 25/25 sweep.
- iOS: **81 unit tests and eight UI tests passed** after session-restoration changes. The subsequent focused task-creation UI test passed with three people requested and `0 of 3 people confirmed` displayed (`/tmp/rally-team-task-ui-fixed.xcresult`). Its first run failed due to the test using the wrong accessibility identifier for the stepper; the corrected test passed. Signed device build, installation and launch succeeded on the connected iPhone. Actual Keychain restoration/refresh and ST-15 still require device observation.
- At **00:32:53 EDT**, `convex dev --once --typecheck enable --tail-logs disable` deployed to verified development target `calm-jackal-984`. The existing local dev watcher was paused during final integration and resumed afterward. The 00:33 health sample showed the existing worker online with no reported error, six completed jobs and none queued/claimed/failed/expired. No worker was duplicated or restarted, so the new polling interval is not claimed as active runtime behavior.

Worker protocol follow-up after the 00:33 health sample: an online heartbeat did not prove that the existing worker could parse the new packets. The old worker's strict schema rejected the added context fields before inference, submitted `{}` to completion and would fail the job as `INVALID_DECISION`. A read-only reproduction using the actual worker/schema source from `9212db4` confirmed zero inference calls for a rich packet.

The compatibility fix adds optional `contextProtocol: 2` to `reasoningJobs.claim`. Updated workers request rich packets; callers omitting the argument receive the exact legacy shape. Legacy clarification packets expose only the verified selected task and include bounded, labeled server facts while preserving participant text. Backend consent, task selection and version checks remain authoritative; heartbeat/completion signatures are unchanged. See the [wire contract](18-bootstrap-contract.md). Final `npm run check` passed **488 tests with one optional test skipped**, including all strict TypeScript checks. In the separate synthetic compatibility check, the actual old worker code accepted the legacy projection, called a fake provider exactly once and completed with a validated assignment proposal. These checks made no live inference or participant-message calls and do not establish deployment or worker restart. The old process still needs reloading to adopt the faster polling interval.

All new source is left in the working tree alongside the preserved pre-existing phone-link fixes. No release tag or production deployment was created.

Runtime follow-up: the compatibility fix deployed successfully to development target `calm-jackal-984` at **00:38:42 EDT**; the existing development watcher was resumed afterward. `npm run worker:configure` preserved the server credential and saved private local configuration. At the user's request, `npm run worker` was then started as a detached local process on this Mac. Provider preflight and authenticated backend heartbeat succeeded before its startup message. The 00:38:57 health sample reported an online worker, a one-second heartbeat age, no error category, six completed jobs and none queued/claimed/failed/expired. The local process uses protocol 2 and the new two-second idle polling code. The earlier worker's host remains unidentified and that process was not stopped; leases coordinate concurrent claimers. No live participant request was generated for this startup check, so this proves local startup/backend connectivity, not a new live coordination result. Local PID/log locations and operating instructions are in [deployment and operations](12-deployment-and-operations.md#local-worker-implementation-and-setup).

| Checkpoint in `prompts/` | Current evidence and remaining gate |
|---|---|
| M1 messaging/domain | Real JOIN, assignment acceptance and prior-run reassignment are evidenced. The October 11 follow-up also exercised guided setup, team capacity, organizer approval and explicit overlap confirmation. Real NO/replay/outage remain open; the follow-up did not repeat an actual reassignment. |
| M2 AI/app | Real natural-language requests and the formerly failing task-ambiguity case worked in the October 11 follow-up. The user separately confirmed iOS force-close/reopen preserved sign-in and displayed matching assignments. Long-lived token refresh remains unverified. |
| M3 freeze | Local regression/rehearsal is automated. Final real-phone walkthrough, timed demo recording and release tag remain open. Weather and other optional integrations stay cut. |

### October 11 live follow-up: guided setup, teams and overlaps

The actual participant run lasted **00:42:42–00:50:24 EDT**. Read-only backend/message review found **49 inbound messages, 66 provider-accepted outbound messages, nine reasoning jobs each completed in one attempt, and two intentionally suppressed outbound rows with zero send attempts**. The broader review snapshot included one earlier status exchange, giving 50 inbound and 67 provider-accepted outbound messages. Provider acceptance is not a delivery receipt; the suppressed rows were obsolete ordinary offers replaced by overlap warnings, not attempted provider failures.

The scheduled event finished with five active commitments and no duplicate or excess staffing:

| Task | Local window on October 12 | Final accepted participants | Capacity |
|---|---|---|---|
| setup | 1–2 PM EDT | Caleb and Yewon | 2/2 |
| speakers | 1:30–2:30 PM EDT | Caleb | 1/1 |
| cleanup | 3–4 PM EDT | Caleb and Yewon | 2/2 |

Observed live behavior covered guided event/task creation, invitation creation and sender-bound named JOIN, a pending team offer surviving another acceptance, deterministic clarification between an active task and a different pending offer, a signed task choice, organizer approval separate from participant acceptance, explicit overlap confirmation, and adding a second teammate to an already occupied task with spare capacity. The speakers task remained unassigned through approval and the initial YES; it changed only after Caleb's explicit overlap confirmation. Yewon's competing speakers offer then became superseded. All six proposals were assignments: five accepted and one superseded. There was **no NO, actual reassignment/release, replay, STOP or RESUME** in this run; those steps must not be reported as passing from this evidence.

Additional cross-event overlap warnings were legitimate: read-only inspection verified still-active commitments from earlier test events. Their private task/event names were replaced with generic references in the warnings. Caleb's self-volunteer requests therefore correctly entered warning/confirmation instead of immediately creating commitments.

After the run, the **user reported** that force-closing and reopening the iOS app preserved sign-in and showed the same assignments. This establishes user-observed relaunch and status parity for this run; it is separate from backend logs and does not verify long-lived token refresh.

Remaining UX friction was also observed. After saving the first task, three bare task-name/time inputs were treated as separate model requests instead of continuing task creation; they produced three generic clarification replies, one after the user had restarted the task wizard. Some outbound instructions still require an opaque offer reference. The organizer received both the speakers acceptance and an awkward competing-offer supersession notice. The live cleanup request correctly added a teammate, but the worker prompt's broad occupied-task/reassignment wording remains a latent add-versus-replace risk. This evidence is a sanitized summary; private conversation bodies, phone numbers, invitation codes and live record IDs are not stored here.

### Closing the October 11 UX pass

The follow-up is limited to friction observed in that run:

- Saving a task now continues with the next task name, or `done`; every task still has a separate review. Delayed setup fragments and obsolete model questions cannot interrupt a newer wizard.
- Approval and overlap instructions use task names and readable event/person qualifiers when unique. Opaque references remain only for unresolved collisions. Closed-offer notices explain current coverage.
- `what's my status?` and other exact casual aliases use deterministic aggregate STATUS without creating a model job.
- Cross-event overlap warnings show local conflict times while keeping other event/task/contact names private. A reviewed `close event <exact name>` → `yes, close it` workflow releases an old event's assignments and retains history. No live event has been closed by this work.
- The worker distinguishes adding a teammate from replacing an assignee. A backend check rejects cancellation/replacement plans when the verified request clearly asks for an additional teammate, before any domain action executes.

Verification: `npm run check` passed **572 tests with one optional test skipped**, including all strict TypeScript checks (`/tmp/rally-polish-final-check.log`). `npm run demo:rehearse` passed both simulated scenarios; `npm run eval:fake` passed **29/29**. The public/internal registered function inventory remains **46**. The closure suite includes rejection of confirmations received before the review was persisted, stale snapshots, lost consent/access, replay and suppression of obsolete offers.

The first real-model sweep on synthetic inputs passed **27/29**, p50 **5,593 ms**, p95 **15,256 ms**. It unnecessarily clarified an explicitly named unassigned task (case 24) and guessed replacement for a vague request on an occupied task (case 29). After a narrow prompt correction, one targeted real-model check each for cases 24, 29 and neighboring cases 25–27 passed **5/5**. Corpus and grading stayed unchanged. The [initial sweep](../tests/eval/results/2026-10-11-polish-initial-live.json) is preserved separately from the [targeted follow-up](../tests/eval/results/2026-10-11-polish-targeted-live.json); this is not a 29/29 sweep. These are interpretation checks, not real phone delivery or domain acceptance tests. Human approval/acceptance remains required; the new additive guard does not claim to resolve every ambiguous staffing phrase.

Known delivery limitation: event closure suppresses stale pending offers, but already queued historical status/acceptance receipts may still arrive afterward. They record prior activity and cannot reopen the event. The previously unidentified older worker remains outside local process control; the backend additive guard applies to its output too, while prompt/polling updates require the worker process to reload.

The agreed stopping point is this UX pass, development deployment and local worker restart. No additional feature pass, production release, live participant test, automatic closure of old events or completion claim for all M3 gates is implied. The previous user-observed iOS relaunch/status result remains valid; this pass changes no iOS source.

Deployment completed at **01:03:52 EDT** to verified development target `calm-jackal-984`, including the two additive indexes. The paused development watcher was resumed. With no queued/claimed jobs, the owned local worker process was restarted to load the new prompt; provider preflight and authenticated heartbeat succeeded. At **01:04:11 EDT**, health showed a two-second heartbeat age, no error category, 15 completed jobs and none queued/claimed/failed/expired. This is runtime health, not a new participant interaction. Only the owned local worker was restarted. Changes remain in the working tree; no commit, push or release tag was created for this pass.

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
