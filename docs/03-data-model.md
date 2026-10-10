# Proposed data model and invariants

Use Convex document IDs and indexed queries. Field names below are the **domain contract**. Lane A messaging and Lane B authorization/domain transitions have simulation test evidence; the live group coordination gate remains pending. See `20-domain-evidence.md`. Creation time uses Convex `_creationTime` unless a field is listed explicitly.

## Entities

| Entity | Required fields | Important indexes |
|---|---|---|
| `users` | `displayName`, `verifiedPhoneE164?`, `createdAt`, `authSubject?`, `messagingState`, `messagingStateAt?`, `settings` | `by_auth_subject`, `by_phone` (unique enforced in mutations) |
| `contactSelections` | `ownerUserId`, `eventId?`, `displayName`, `phoneE164`, `selectedAt`, `invitationId?` | `by_owner`, `by_event` |
| `invitations` | `purpose:event_invite|app_phone_link`, `eventId?`, `inviterUserId`, `contactSelectionId?`, `targetUserId?`, `codeHash`, `state`, `expiresAt`, `failedAttempts`, `redeemedByPhoneE164?`, `redeemedAt?` | `by_code_hash`, `by_event`, `by_contact_selection` |
| `events` | `title`, `kind:event|project`, `startsAt`, `timezone`, `location?`, `ownerId`, `status`, `version`, `weatherPolicy?` | `by_owner`, `by_start` |
| `memberships` | `userId`, `eventId`, `role:organizer|member`, `state`, `notificationsEnabled`, `joinedAt?`, `consentAt?`, `consentSourceMessageId?` | `by_event`, `by_user`, `by_event_user` |
| `tasks` | `eventId`, `title`, `location?`, `windowStart?`, `windowEnd?`, `requiredSkills?`, `capacity` (default 1), `dependsOnTaskIds?`, `status`, `version` | `by_event` |
| `commitments` | `eventId`, `taskId`, `participantId`, `state`, `sourceProposalId?`, `sourceMessageId?`, `createdAt`, `endedAt?`, `endedByActorId?` | `by_event`, `by_task`, `by_participant` |
| `availability` | `eventId`, `userId`, `windowStart`, `windowEnd`, `kind:available|unavailable`, `source:self_reported|organizer_reported`, `reportedByUserId`, `sourceMessageId?`, `recordedAt` | `by_event_user` |
| `proposals` | `eventId`, `type`, `originatorId`, `subjectId?`, `targetTaskId?`, `targetUserId?`, `taskChangeJson?`, `state`, `requiresOrganizerApproval`, `organizerApprovedAt?`, `eventVersionAtCreation`, `taskVersionAtCreation?`, `expiresAt`, `idempotencyKey` | `by_event`, `by_target`, `by_idempotency` |
| `inboundMessages` | `provider`, `providerMessageId`, `senderPhone`, `receivedAt`, `contentType`, `bodyRedactedOrEncrypted?`, `eventId?`, `processingState` | `by_provider_message_id`, `by_sender` |
| `outboundMessages` | `idempotencyKey`, `recipientUserId`, `eventId?`, `proposalId?`, `directReplyToMessageId?`, `content`, `state`, `attemptCount`, `providerMessageId?` | `by_key`, `by_state` |
| `conversationFocus` | `userId`, `lastEventId?`, `lastIntent?`, `updatedAt`, `expiresAt` | `by_user` |
| `reasoningJobs` | `messageId`, `eventId` (nullable), `contextVersion` (nullable), `taskVersions`, `status`, `leaseOwner?`, `leaseToken?`, `leaseUntil?`, `attempts`, `result?`, `failureCategory?`, `executedDecisionJson?`, `executionResultJson?` | `by_status`, `by_message` |
| `workerHeartbeats` | `workerId`, `lastHeartbeatAt`, `modelId?`, `lastError?` | `by_worker` |
| `auditEvents` | `actorType:user|agent|system`, `actorId?`, `eventId`, `action`, `oldStateRef?`, `newStateRef?`, `at`, `sourceId` | `by_event`, `by_time`, `by_source` |
| `weatherObservations` | `eventId`, `source`, `retrievedAt`, `forecastFor`, `precipProbability?`, `thresholdCrossed`, `policyVersion` | `by_event_time` |

Minimize persisted selected contact data; ideally store only participants explicitly added to an event, not the entire address book. Phone numbers may require encryption/limited access; keep third-party contact data out of prompts. Encrypted values can't be looked up, so if phone numbers are encrypted at rest, index a keyed hash (HMAC-SHA256 with a server-only `RALLY_PHONE_HASH_KEY`) of the normalized E.164 value for `by_phone`, `by_sender` and invitation matching, and keep the encrypted value for display only.

**Assignees are derived, not stored on the task:** a task's current assignees are its `commitments` with `state=active`. Pending offers live only in `proposals`. A pending proposal's `expiresAt` is the hold/reservation TTL; there is no separate reservation table.

## Canonical state enums

This section is the **single source of truth** for persisted states. Other docs, the iMessage copy, and the iOS app must use these values (or the display labels in [`06-workflows.md`](06-workflows.md#status-vocabulary), which are derived from them).

| Field | Values | Notes |
|---|---|---|
| `users.messagingState` | `active`, `paused`, `stopped` | Set by `PAUSE`/`RESUME`/`STOP`. Identity-wide, across events. |
| `invitations.state` | `pending`, `redeemed`, `expired`, `revoked` | Single use; code hashed at rest. |
| `events.status` | `draft`, `scheduled`, `canceled`, `completed` | `draft` until the organizer confirms (W2). |
| `memberships.state` | `invited`, `enrolled`, `left` | `invited` = selected/invited but not yet `JOIN`ed; the organizer sees "Waiting for them to text Rally". |
| `tasks.status` | `unassigned`, `confirmed`, `needs_coverage`, `completed`, `canceled` | Reflects **committed** state only. `needs_coverage` = previously filled, assignee released or canceled. A pending offer does not change task status. |
| `commitments.state` | `active`, `released`, `canceled_by_participant`, `completed` | `released` = ended by an organizer override or by an accepted replacement (ADR-011). |
| `proposals.state` | `pending`, `accepted`, `declined`, `expired`, `superseded`, `canceled` | `superseded` = a competing acceptance won; `canceled` = target left/stopped or organizer withdrew. |
| `proposals.type` | `assignment`, `reassignment`, `task_change` | Proposal categories from the action union; draft creation and self-report actions do not create a separate proposal category. |
| `inboundMessages.processingState` | `received`, `processing`, `processed`, `failed` | Durable receipt and processing progress, independent of domain and outbound state. |
| `outboundMessages.state` | `queued`, `sending`, `sent`, `delivered`, `failed`, `unknown` | `sent` = provider accepted; `delivered` only with a provider receipt; `unknown` = timeout, reconcile before retry. |
| `reasoningJobs.status` | `queued`, `claimed`, `completed`, `failed`, `expired` | `expired` after max attempts. |

## Bootstrap contract details (ADR-016)

Prompt 0 fixes these previously unspecified nested shapes. They describe contracts, not implemented transitions:

- `users.settings`: optional `timezone` and optional `skills` string array; defaults are not inferred from an empty object.
- `events.location`: optional text. `weatherPolicy`, when present, follows `09`: `enabled`, `condition=precipitation_probability_gte`, `thresholdPercent`, `leadTimeHours`, `version`, optional `latitude`/`longitude`, and optional `alternative={type:indoor_backup,location}`.
- `proposals.subjectId`: optional user ID. The proposal category is defined above.
- `tasks.location`: optional text; `proposals.taskChangeJson` preserves the proposed time/location as serialized `ProposeTaskChangeActionSchema` data. Parse and validate before persistence/use. Pending changes never replace current task fields before approval.
- `outboundMessages.directReplyToMessageId`: optional evidence for the direct-reply exception. The dispatcher must revalidate that the referenced verified inbound belongs to the recipient; persistence does not grant consent for unrelated future sends.
- `reasoningJobs.eventId` binds the job to its authorized event, independently of model output or later conversation focus. For a first-event draft or clarification with no selected event, both `eventId` and `contextVersion` are `null`, and `taskVersions` is empty. Such a job permits only `CREATE_EVENT_DRAFT`, `ASK_CLARIFICATION`, or `NO_ACTION`; an unscoped result cannot acquire authority to modify existing events.
- `reasoningJobs.taskVersions`: array of `{taskId, version}` captured by trusted enqueue code alongside `contextVersion`. Completion checks this persisted snapshot, not a worker-supplied replacement snapshot. A unique `leaseToken` identifies each claim independently of the long-lived worker identity.
- `reasoningJobs.result`: canonical JSON text of a validated shared `AgentDecision`. `decisionJson` and `packetJson` function arguments/results are serialized wire envelopes; implementations must parse them using the shared Zod schemas before using them. A string validator alone does not validate a model decision.
- `executedDecisionJson` / `executionResultJson`: Lane B's canonical validated decision and its transaction result. These cache a successful execution, including null-scope clarification/drafts, independently of worker completion. A replay must match the cached decision; it cannot change the action. The audit `by_source` index supports transactional request deduplication and binds each YES/NO message to one proposal response.

The schema and all backend functions are bootstrap scaffolding until the owning lane implements and tests their behavior.

## Identity model

- App identity is verified using a production-capable auth provider or a secure one-time phone-link challenge (`invitations.purpose=app_phone_link`). **Do not trust a client-supplied userId**.
- Inbound Photon sender identity must be derived from *verified webhook transport metadata*, not an untrusted message body.
- Link the phone to a user only after proof-of-control: they send `JOIN <one-time code>` from that number and the code matches a `pending` invitation. Hash short-lived codes, expire and rate-limit.
- Being selected from someone's contacts is not an enrolled membership; there must be an actual opt-in event.

## Core invariants

1. Unique `(provider, providerMessageId)` logical inbound event; no actions on repeats.
2. Unique `(eventId,userId)` enrolled membership per event, enforced by a mutation/index lookup.
3. A task has at most `capacity` commitments with `state=active` (default 1).
4. A proposal may be accepted only by its target participant or an explicitly authorized override actor.
5. Proposal acceptance is conditional on `state=pending`, `expiresAt>now`, matching `events.version` **and** (for task proposals) matching `tasks.version` of the target task, and no relevant assignment conflict.
6. Versioning is two-level so one task's change doesn't invalidate offers on other tasks: `events.version` increments only on event-level changes (`startsAt`, `timezone`, `location`, `status`, `weatherPolicy`); `tasks.version` increments on any change to that task (window, location, capacity, status, a commitment created or ended). Scoped worker output is checked atomically against `reasoningJobs.contextVersion` (the event version) and the versions of every task it references. Null-scope jobs have the restricted behavior defined above and cannot modify existing events.
7. Pending proposal and confirmed commitment are different objects/states; status messages must reflect this.
8. All reads/writes are scoped to membership or organizer permission. Unauthorized user cannot infer event existence or members.
9. Audit logs are append-only through privileged code; include actor/evidence but not raw private secrets.
10. Weather snapshots never directly rewrite assignments or event times.
11. No outbound message to a user whose `messagingState` is not `active` or who lacks an `enrolled` membership in the message's event (except the direct reply to that user's own inbound message, e.g. onboarding or `STOP` acknowledgement).

## Minimal seed fixture

- Event: `Charity 5K`, Saturday 10:00–13:00 local, location `UNC campus`, timezone `America/New_York`.
- Alex: organizer. Maya: enrolled member with an `active` commitment to `setup` (10:00–11:00). Jordan: enrolled member, `available` 10:00–11:00, no conflicting commitment.
- Another event `Hack Night` with Alex as organizer, Jordan as member, and its own `setup` task to test ambiguity.
- Contact `Taylor` selected for Charity 5K with membership `invited` (never `JOIN`ed), to test zero outbound messages before opt-in.

## Storage retention

Define a cleanup schedule for expired invitation/phone-link codes, reasoning context snapshots, and old raw message payloads. Exact retention period is a product decision; do not invent user consent or retain the full address book indefinitely.
