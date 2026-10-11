# iOS account and status contracts

Implemented on `lane/d-ios-integration`, 2026-10-10, as an additive A/B/D continuation authorized by the user. Existing domain mutation inputs and canonical enums are preserved. Verification is recorded in [the app README](../ios/Rally/README.md). The phone-link correction is deployed to development; physical-device sign-in, assigned-number display and corrected real JOIN phone verification are user-confirmed. Event messaging consent and full message/app parity remain separate live gates.

## Public reads

| Query | Input | Result and authorization |
|---|---|---|
| `accounts.current` | `{}` | `{userId,displayName,phoneLinked,messagingState}` for the verified caller only. No phone, auth subject or settings returned. Registration precedes this read; the app exposes protected screens only after its first authorized value. |
| `appStatus.overview` | `{}` | `[{eventId,progress}]` for the caller's enrolled events only. |
| `appStatus.event` | `{eventId}` | `{eventId,progress,messaging,route,activity}` after identity and enrolled-membership checks. Organizer access does not imply message consent. |
| `appStatus.route` | `{}` | The current caller's route, available only with a server-verified phone. No arbitrary recipient lookup. |

`progress` is `{total,confirmed,needsCoverage,completed,canceled}`. Counts use canonical task state; `needsCoverage` includes unassigned tasks. Pending proposals and organizer approval never increment confirmed counts.

`messaging` is `{membershipState,consentRecorded,notificationsEnabled,messagingState,canReceiveMessages}`. Consent requires the membership's recorded source, the caller's verified phone, and an authenticated encrypted Spectrum JOIN envelope. Notification permission additionally requires enrolled membership, enabled notifications and global active messaging state. This is permission to receive messages, not a delivery guarantee. STOP/PAUSE disable it; LEAVE removes access to the event read.

`activity` contains at most 30 entries, newest first, with `{id,kind,at,title,deliveryState?}`. Domain titles are a static allowlist; arbitrary audit actions and raw source/state references are excluded. Delivery entries include only this caller's outbound rows within the selected event. Their timestamp is message creation and their state is the current canonical delivery state. `sent` means provider accepted; only a receipt permits `delivered`. Neither messages, actor identities, private contacts nor unrelated event data are returned.

Runtime schemas live in `packages/shared/appStatus.ts`; Convex validators and function inventory also cover the new APIs. These queries perform no messaging or consent writes.

## Phone-link challenge

`accounts.beginPhoneLink({phoneE164,idempotencyKey})` requires a registered authenticated account and returns `{invitationId,code,expiresAt,route}`. The caller-owned challenge may display the requested phone's authoritative bot destination before phone proof. It exposes no participant profile, event membership or consent. This exception requires active trusted provisioning and uses the same rotation/revocation checks as verified routing; its expiry is the earlier of challenge expiry and route expiry. Unassigned phones return an unavailable route with explicit setup instructions in the app.

An authenticated Spectrum `JOIN <code>` from the selected phone records proof and returns the fixed instruction to finish in Rally. It leaves the challenge pending and does not attach the app identity or enroll an event. Only `accounts.completePhoneLink`, with the challenge owner's app session and persisted signed proof, reconciles an existing unbound phone identity or verifies a new phone. Another app identity's phone remains protected. Event JOIN remains separate.

## Verified contact routing

The route union is `{status:"available",destination,expiresAt}` or `{status:"unavailable"}`. Destination is strict E.164 and expiry is integer Unix milliseconds. The app hides the shortcut at expiry even without a reactive query update, rechecks it at tap time, and disables it on stale connections and in demo mode. The [Apple SMS URL contract](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/SMSLinks/SMSLinks.html) is used without message text or additional recipients; opening Messages never sends automatically.

Installed `@spectrum-ts/imessage` 12.10.1 uses a `shared` sentinel, and inbound sender/space IDs identify the participant rather than an assigned bot number. Therefore routing accepts only:

1. The newest authenticated encrypted inbound envelope's dedicated `linePhone`, if it is valid E.164, differs from the participant, and is less than 24 hours old; or
2. An authoritative participant-to-Rally allocation entered through the trusted internal provisioning boundary below.

Missing, invalid, corrupt and future observations return unavailable. Shared-mode evidence alone supplies no number. A current trusted allocation can survive newer `shared` observations when all later observations are valid and either shared or match that allocation. A different dedicated line supersedes provisioning; any intervening conflicting/missing/corrupt observation prevents a later shared sentinel from resurrecting the old number. This bounded check accepts at most 30 observations since provisioning; more require revalidation. Expired/revoked provision records suppress all inbound fallback. The maximum route lifetime is 24 hours. This conservative bound requires revalidation; it is not a claim about provider allocation lifetime.

### Operator handoff

After verifying the current allocation through the provider's authoritative provisioning channel, an authorized backend operator/adapter may call internal `appStatus.recordProvisionedRoute` with:

```ts
{
  participantPhoneE164, // verified participant address
  destination,          // that participant's assigned Rally destination
  verifiedAt,           // current verification time, integer milliseconds
  expiresAt,            // future and <= verifiedAt + 86_400_000
  providerReference     // bounded allocation reference, no credentials
}
```

The mutation validates E.164, different addresses, bounded TTL and monotonically newer verification; exact retries are idempotent. It stores `messagingRoutes` indexed by participant phone. Do not infer the destination from a DM sender or use another participant's assigned number. This table is backend-only; public apps and messages cannot provision or revoke routes. No automatic provider lookup or refresh is claimed.

Internal `appStatus.revokeProvisionedRoute({participantPhoneE164})` creates a server-timestamped tombstone, including when no record exists. Only strictly newer trusted provisioning restores a revoked route. Routing metadata is private operational data; the public query projects only the caller's current destination/expiry. Invitation sharing remains code-only: an invitee must use their own provisioned Rally conversation.

On 2026-10-10, the operator verified the reporting user's participant-to-bot allocation in the authenticated Photon Users dashboard and recorded it on the development deployment with a 24-hour expiry. Addresses remain outside repository artifacts. New participants still need provider setup and trusted route registration; automatic Photon user provisioning and refresh are not implemented.

## Public errors and session behavior

App-facing account/event/task/invitation/approval/status functions use `withPublicErrors` to return a `ConvexError` whose data is exactly `{version:1,code}`. The allowlist in `packages/shared/publicErrors.ts` covers authentication, access, input, phone proof/expiry/conflict, idempotency, stale versions and closed events. Unknown/internal exceptions become `INTERNAL_ERROR`, without raw error text. Framework argument validation occurs before this wrapper and may still produce ordinary SDK errors.

The Swift adapter accepts only actual SDK `ClientError.ConvexError` JSON of the agreed version/shape/code. Raw `ServerError` text and unknown payloads receive safe local copy. Authentication failures clear the session; denied/failed queries clear protected results. Account status is continuously observed, canonical identity changes recreate scoped views, and loss of verified account state disables event creation until an authorized read succeeds.

## Acceptance boundaries

Backend fixtures test identity/membership denial, canonical account changes, safe error payloads, consent evidence, STOP/PAUSE/LEAVE, committed counts, redacted activity, caller-only delivery, route rotation, expiry, revocation and invalid evidence. Swift adapter/session/model/presentation tests cover corresponding wire and state transitions. UI tests are explicitly simulated and cannot open Messages through demo routes.

These additions do not complete M1 live verification, ST-15, physical-device acceptance or Lane C's reasoning/worker work. No cloud state, provider configuration, real login or messages were used during this continuation.
