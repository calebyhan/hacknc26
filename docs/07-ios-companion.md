# SwiftUI companion app spec

## Principle

The app is **not** where users normally ask Rally questions. It configures the agent and provides visual confirmation of event state. Texting is the primary surface.

## Minimal navigation

1. **Onboarding** — app identity/phone linking, concise disclosure, link to Rally iMessage instructions.
2. **My Events** — title, time, organizer/member role, one-line progress; create button for organizer.
3. **Create Event** — title, local date/time, timezone, location, event type; optional weather-sensitive checkbox.
4. **Select People** — system contact picker, choose only relevant contacts, review before creating invitations.
5. **Event Detail** — participants (invited/enrolled), assignments, pending approvals, short agent activity timeline, open iMessage shortcut.

## Contacts design

Use Apple's `CNContactPickerViewController` via SwiftUI wrapper (or a current Apple privacy-preserving contact-selection API). The picker exposes **only final user-selected contacts** and doesn't require full-address-book read permission in the classic flow. Normalize selected phone numbers locally, show confirmation, persist only contacts deliberately selected for a specific event. Never upload/sync the whole address book by default.

Because a selected contact might have no iMessage or Photon enrollment, preserve separate invite and enrolled statuses; display “Waiting for them to text Rally,” not “Joined.”

## Authentication decision

We need an actual signed-in identity for organizer writes. Options: a supported Convex Swift auth provider (e.g. Auth0/Clerk) or an appropriate secure passwordless solution. **This is a launch-blocking choice; do not substitute an unprotected client-provided `userId`**. For hackathon setup, restrict to a few test accounts if necessary, but never expose full deployment writes without auth.

Phone linking: app displays a unique short-lived code, user sends from their own phone to Rally; validated webhook associates the messaging identity with app user, with a replay-resistant expiry and rate limit.

## Event overview fidelity

- Show **confirmed** vs **proposed** assignments distinctly.
- Show “Rally is waiting for Jordan” only if a pending proposal exists.
- Display latest event version/time and offline/stale state; don't promise real-time progress when worker is offline.
- Reactively subscribe to authorized queries via Convex Swift client if supported by chosen auth setup.
- Ask before overwriting competing changes from other participants.

## App component sketch

```text
RallyApp
  AuthGate
  EventListView
    EventCreateView
      NativeContactPicker
  EventDetailView
    ParticipantsSection
    TasksSection
    AgentActivitySection
  OnboardingAndLinkPhoneView
```

## Widget (P2)

Single card: next event, date/time, count of confirmed vs outstanding commitments, deep link into app. WidgetKit updates are system-budgeted; don't claim immediate real-time update or agent-run background work through the widget.

## Accessibility and polish

Large Dynamic Type; VoiceOver names; clear pending/confirmed labels not color alone; loading/error/empty states; no private contact details in screenshots. Avoid spending hackathon hours on animations before messaging and state transitions pass.
