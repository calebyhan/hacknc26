# Proposed data model and invariants

Use Convex document IDs and indexed queries. Field names below are the **domain contract**; the exact `convex/schema.ts` structure is to be implemented.

## Entities

| Entity | Required fields | Important indexes |
|---|---|---|
| `users` | `displayName`, `verifiedPhoneE164?`, `createdAt`, `authSubject?`, `settings` | `by_auth_subject`, `by_phone` (unique enforced in mutations) |
| `contactSelections` | `ownerUserId`, `eventId?`, `displayName`, `phoneE164`, `selectedAt`, `invitationStatus` | `by_owner`, `by_event` |
| `events` | `title`, `kind:event|project`, `startsAt`, `timezone`, `location?`, `ownerId`, `status`, `version`, `weatherPolicy?` | `by_owner`, `by_start` |
| `memberships` | `userId`, `eventId`, `role:organizer|member`, `state:invited|enrolled|left`, `notificationsEnabled`, `joinedAt?` | `by_event`, `by_user`, `by_event_user` |
| `tasks` | `eventId`, `title`, `windowStart?`, `windowEnd?`, `requiredSkills?`, `assigneeId?`, `status:unassigned|proposed|confirmed|done|canceled`, `version` | `by_event`, `by_assignee` |
| `commitments` | `eventId`, `taskId`, `participantId`, `status:proposed|accepted|declined|revoked`, `sourceMessageId?`, `createdAt`, `resolvedAt?` | `by_event`, `by_participant` |
| `proposals` | `eventId`, `type`, `originatorId`, `subjectId?`, `targetTaskId?`, `targetUserId?`, `state`, `eventVersionAtCreation`, `expiresAt`, `idempotencyKey` | `by_event`, `by_target`, `by_idempotency` |
| `inboundMessages` | `provider`, `providerMessageId`, `senderPhone`, `receivedAt`, `contentType`, `bodyRedactedOrEncrypted?`, `eventId?`, `processingState` | `by_provider_message_id`, `by_sender` |
| `outboundMessages` | `idempotencyKey`, `recipientUserId`, `proposalId?`, `content`, `state`, `attemptCount`, `providerMessageId?` | `by_key`, `by_state` |
| `conversationFocus` | `userId`, `lastEventId?`, `lastIntent?`, `updatedAt`, `expiresAt` | `by_user` |
| `reasoningJobs` | `messageId`, `contextVersion`, `status`, `leaseOwner?`, `leaseUntil?`, `attempts`, `result?`, `failureCategory?` | `by_status`, `by_message` |
| `auditEvents` | `actorType:user|agent|system`, `actorId?`, `eventId`, `action`, `oldStateRef?`, `newStateRef?`, `at`, `sourceId` | `by_event`, `by_time` |
| `weatherObservations` | `eventId`, `source`, `retrievedAt`, `forecastFor`, `precipProbability?`, `thresholdCrossed`, `policyVersion` | `by_event_time` |

Minimize persisted selected contact data; ideally store only participants explicitly added to an event, not the entire address book. Phone numbers may require encryption/limited access; keep third-party contact data out of prompts.

## Identity model

- App identity is verified using a production-capable auth provider or a secure one-time phone-link challenge. **Do not trust a client-supplied userId**.
- Inbound Photon sender identity must be derived from *verified webhook transport metadata*, not an untrusted message body.
- Link the phone to a user only after proof-of-control, e.g. they send `JOIN <one-time code>` from that number and the code matches an invitation. Hash short-lived codes, expire and rate-limit.
- Being selected from someone's contacts is not an enrolled membership; there must be an actual opt-in event.

## Core invariants

1. Unique `(provider, providerMessageId)` logical inbound event; no actions on repeats.
2. Unique `(eventId,userId)` enrolled membership per event, enforced by a mutation/index lookup.
3. A task can have at most **one** active confirmed exclusive assignee; allow multiple only if task capacity explicitly supports it.
4. A proposal may be accepted only by its target participant or an explicitly authorized override actor.
5. Proposal acceptance is conditional on `state=pending`, `expiresAt>now`, matching `eventVersion`, and no relevant assignment conflict.
6. `events.version` increments on consequential event/task changes. Check version atomically before committing stale worker output.
7. Pending proposal and confirmed commitment are different objects/states; status messages must reflect this.
8. All reads/writes are scoped to membership or organizer permission. Unauthorized user cannot infer event existence or members.
9. Audit logs are append-only through privileged code; include actor/evidence but not raw private secrets.
10. Weather snapshots never directly rewrite assignments or event times.

## Minimal seed fixture

- Event: `Charity 5K`, Saturday 10:00–13:00 local, location `UNC campus`, timezone `America/New_York`.
- Alex: organizer; Maya: member, confirmed check-in; Jordan: enrolled member available for 10:00–11:00 setup.
- Another event `Hack Night` with overlapping participant and a `setup` task to test ambiguity.
- Contact `Taylor` selected but not enrolled, to test zero outbound messages before opt-in.

## Storage retention

Define a cleanup schedule for expired phone-link codes, reasoning context snapshots, and old raw message payloads. Exact retention period is a product decision; do not invent user consent or retain the full address book indefinitely.
