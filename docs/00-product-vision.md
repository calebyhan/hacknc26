# Product vision and judging fit

## Problem

Small groups coordinate through fragmented messages, screenshots, and casual promises. People forget what they agreed to; plans have to be re-explained across threads; one change disrupts several responsibilities. Group scheduling apps can capture events but generally cannot meaningfully follow through with members through natural conversation.

## Rally's proposed solution

An iMessage-native agent that maintains **shared, permissioned commitment memory**, helps organizers and friends make plans, detects changes, asks only the necessary questions, and completes approved coordination workflows.

Core product loop: **Observe → interpret → retrieve scoped context → evaluate constraints → ask/act → verify response → update shared state → notify selectively**.

## Core users

1. Organizer of a small campus/volunteer/club event (initial primary persona).
2. Participant with commitments who prefers replying in iMessage.
3. Group of friends planning a casual event (second demo if reliable).

## Job stories

- When my volunteer cancels, I want Rally to figure out who could cover, ask them, and update everyone when the assignment is accepted.
- When someone casually texts “I'll bring speakers,” I want Rally to associate the promise with the correct event, without making it up when ambiguous.
- When weather threatens an outdoor event, I want Rally to warn me early and suggest options—**not** unilaterally move everyone's plans.
- When I open the companion app, I want to see the latest committed state and what Rally is waiting for.

## Product boundaries

- iMessage is the **primary UI**. App is setup, roster, permissions, status and light observation.
- Support both `event` and `project` concepts in the data model if cheap, but **event-first UX** for 24h MVP.
- Formal event behavior: deadlines, roles, staffing, resource and dependency checks.
- Casual behavior: RSVPs, flexible timing, preferences and minimal process. **Stretch** unless core formal event works.
- No autonomous mass outreach. Never let model persuade, override, or fabricate consent.
- No weather-based automatic cancellation/rescheduling without authorized confirmation.

## Winning-story alignment

**HackNC General:** tangible coordination value; functional real messaging; engineered correctness; explainable contextual inference and planning; compelling disruption-recovery demo.

**Photon:** Spectrum is non-optional; meaningful persistent context across people and time; selective proactive messages; the ability to participate in real tasks; graceful nonresponses; human-in-the-loop trust.

**Additional tracks:** Community is natural if demo centers volunteer/student organizations; Gemini track only if its API is actually integrated, not just planned. No other track is required.

## Product metrics (targets, not claims)

- 100% of accepted task assignments in the demo trace have an approving participant or authorized organizer override.
- Zero duplicate commitments/outbound notifications under replayed inbound event IDs.
- Zero unauthorized event data leaked into another participant's session.
- For a seeded 20-message test corpus, target correct event selection when clear and a clarification question when truly ambiguous.
- Demonstrate one live plan repair end to end in approximately 90 seconds (network variability permitting).

## Explicit non-goals

No comprehensive consumer calendar, no generic autonomous computer agent, no public event discovery marketplace, no broad contact scraping, no large iOS feature set, no assumption that Photon Pro provides a shared dedicated group-chat number.
