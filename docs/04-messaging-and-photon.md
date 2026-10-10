# Photon Spectrum integration specification

**Required:** use Photon **Spectrum** for the hackathon track. The product must successfully send/receive messages through real iMessage in the demo.

## Current reference architecture

Prefer the official `@spectrum-ts/convex` integration (official Photon blog, npm package) if it supports the event types and webhook setup in the pinned version. Its advertised features include HMAC-verified durable ingestion, settling/debounce of burst messages, and scheduled outbound sending. Verify actual registration signatures in current package code; do not invent them.

Provider docs:
- https://photon.codes/docs/spectrum-ts/introduction
- https://photon.codes/blog/your-convex-agent-can-text-now-using-photon
- https://www.npmjs.com/package/@spectrum-ts/convex
- https://photon.codes/pricing

## Plan-tier constraints

As publicly listed October 2026, managed Free/Pro iMessage numbers are **shared**, not one canonical project number. Pro lists direct-message API access and a user cap, while dedicated lines and full group messaging API access are Business. Do not assume the hackathon promotion changes this. Ask Photon whether special group privileges are granted. MVP must work through **separate enrolled 1:1 conversations**.

Because a Pro shared line may assign different numbers to different participants, UI copy must not promise that “everyone texts the same number.” Instead provide each participant their Rally contact or onboarding instructions as actually provisioned by Photon.

## Sender enrollment and opt-in

1. Organizer picks specific contacts in-app, sees a review/consent screen.
2. Rally creates short-lived invitation references but does **not** automatically blast numbers. Share invite instruction through a user-controlled method or an authorized provider flow.
3. Participant initiates inbound message to the agent, optionally with a one-time code to link to the selected contact identity.
4. Upon successful verification, set membership `enrolled`, record notification consent with scope/event and timestamp.
5. Allow `STOP`, `PAUSE`, `RESUME`, and `LEAVE <event>` to update preferences. Handle these deterministically before model invocation.
6. If no opt-in or messaging relationship exists, expose a status `awaiting_join` to organizer; do not send an unsolicited message.

## Inbound pipeline

```
Photon inbound webhook
  -> built-in verification, if adapter used
  -> durable event with stable provider ID
  -> dedupe and normalize content
  -> link sender to enrolled phone/user if possible
  -> capture recent consecutive messages via debounce where safe
  -> parse STOP/YES/NO/status/pending proposal deterministically
  -> context resolution and/or inference job
  -> validation/approval workflow
  -> outbox send, with retries and reconciliation
```

A message may contain photos or other attachments; store only necessary references and extract metadata with the current Spectrum SDK. If attachment API or permissions are unavailable, treat image understanding as optional; never block the core text flow.

**Debounce caveat:** a 'yes' answering a pending proposal should not be swallowed by a merged message batch or mixed with unrelated senders. Test webhook component's cancellation behavior against actual reply semantics.

## Outbound content policy

- Replies should be short, friendly, clear, and truthful about state.
- If unable to identify an event, ask a short question with 2 choices rather than guessing.
- Avoid sending raw attendance lists or phone numbers to unrelated participants.
- Reassignment request example: `Maya can't cover setup Saturday 10–11. Could you take it? Reply YES or NO.`
- Pending reply example: `I asked Jordan to cover setup; still waiting for a response.`
- Confirmation example: `Jordan accepted setup, 10–11. I've updated the assignment.`
- Failure example: `I couldn't reach Jordan yet. The original assignment hasn't changed.`

## Failure cases to implement

Invalid webhook signature → reject. Duplicate message → acknowledge with no second side effect. Unknown sender → onboarding/limited help. Missing participant consent → no outbound. Provider timeout → mark `unknown` or failed and reconcile before duplicate retry. Spam burst → per-user throttling and clear UX. Worker offline → deterministic handling and transparent delayed response.

## Provider spike checklist

- [ ] Create Photon project and connect iMessage through dashboard.
- [ ] Record plan tier and actual phone-number behavior for two test participants.
- [ ] Install pinned Spectrum + Convex package versions.
- [ ] Configure `SPECTRUM_WEBHOOK_SECRET`, `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET` **server-side** as documented.
- [ ] Send one opted-in real inbound DM and one real outbound reply.
- [ ] Test 2-message burst, duplicate webhook, reply-to-pending-action, contact not enrolled.
- [ ] Record any exact API differences in `14-decisions-and-open-questions.md`.
