# Reasoning engine and Claude worker contract

## Objective

Seamlessly interpret informal iMessages, reuse compact context, and produce structured proposals at low incremental cost. Claude makes **suggestions, never privileged writes**. Common confirmation/status paths bypass Claude.

## Model/runtime recommendation

Run a persistent Node.js/TypeScript process on the team's Apple Silicon Mac. Use the Claude Agent SDK or `claude -p` under the developer's Claude subscription **subject to current terms and plan limits**. Claude executes remotely, not on-device; the local machine hosts the worker process. Use the model actually available in `/model` (prefer a fast Sonnet-class model for complex requests); do not hardcode a model ID before checking current access. Limit turns, tools, context size, and concurrency. Disable general filesystem/shell/browser tools for untrusted user text.

**Important:** SDK and CLI usage may consume subscription limits or credits, not unlimited free API usage. A Claude Code login is not itself a production SLA. If subscription-based worker access cannot be used in the needed mode, swap in an explicitly authorized model provider through the adapter or use the constrained rules fallback. Do not silently put an API key in `.env` that could charge the team.

## Three-tier handling

1. **Rules (no model):** `YES`, `NO`, `STOP`, `STATUS`, `HELP`, pending proposal confirmation, known event short IDs, deadline checks, scripted fallback.
2. **Small model job:** intent extraction, entity reference resolution, conversational event lookup, short clarifications.
3. **Complex model job (optional):** compound asks, long unstructured event description, text extracted from flyer/photo, proposed task constraints.

## Context packet (example; not a full transcript)

```json
{
  "messageId": "msg_demo_29",
  "sender": {"userId": "usr_alex", "role": "organizer"},
  "recentEventFocusId": "event_charity_5k",
  "candidateEvents": [
    {"id": "event_charity_5k", "title": "Charity 5K", "startsAt": "2026-10-17T14:00:00Z"}
  ],
  "relevantTasks": [
    {"id": "task_setup", "name": "setup", "assigneeId": "usr_maya", "status": "confirmed"}
  ],
  "pendingActionsForSender": [],
  "incomingText": "Maya can't do setup. Could Jordan cover it?",
  "eventVersion": 7
}
```

Do not include other users' unrelated events, entire contact lists, or cross-event private messages. For complex tasks, add only relevant structured constraints.

## Structured output contract

The worker emits an `AgentDecision` object that passes a runtime validator (Zod); unknown actions or fields fail closed. Domain IDs must be resolved by trusted backend queries, never accepted solely from free text.

```json
{
  "schemaVersion": 1,
  "eventCandidateId": "event_charity_5k",
  "confidenceClass": "clear",
  "needsClarification": false,
  "clarificationQuestion": null,
  "actions": [
    {
      "type": "PROPOSE_REASSIGNMENT",
      "taskRef": "setup",
      "fromParticipantRef": "Maya",
      "toParticipantRef": "Jordan"
    }
  ],
  "responseStyle": "concise",
  "reasonCodes": ["RECENT_EVENT", "TASK_MATCH"]
}
```

Proposed discriminated action union:

- `CREATE_EVENT_DRAFT` (never publish without organizer confirmation)
- `ADD_INVITEE_DRAFT` (does not enroll or send without consent)
- `PROPOSE_ASSIGNMENT`
- `PROPOSE_REASSIGNMENT`
- `RECORD_AVAILABILITY` (from speaker about themself only)
- `REQUEST_STATUS`
- `ASK_CLARIFICATION`
- `NO_ACTION`

No `RAW_HTTP`, `EXECUTE_CODE`, `SEND_ANY_MESSAGE`, `MARK_CONFIRMED`, or `UPDATE_ANY_DB_ROW` action types.

## Validation / execution

1. Parse valid JSON; reject if invalid or extra actions exceed cap.
2. Resolve event in authorized membership scope. Require explicit choice when ambiguous.
3. Resolve people and task names against *that event's* members and tasks.
4. Revalidate event version and permissions inside mutation.
5. Create proposals for cross-person actions; do not execute silently.
6. Compose outbound message from trusted structured state, not raw model-generated assertion.
7. Record event/action trace for audit and debugging.

## Intent confidence policy

Use `clear|ambiguous|unsupported`; avoid uncalibrated invented confidence percentages. Default to clarify if two plausible event matches remain or an action could surprise a participant. Timeout after a bounded period and ask the user to retry or simplify instead of fabricating success.

## Failure and cost control

- Limit context tokens and batch rapid same-sender messages where safe.
- Worker single-run time cap; at most 1–2 concurrent jobs for demo.
- Lease expiration and max attempts; idempotent completion only once.
- Alert organizer/participant of delay after timeout; never send repeated “working on it” pings.
- Keep a deterministic `FakeInferenceProvider` for tests and a `ClaudeInferenceProvider` for live use.
- If local worker is down, simple in-flight offers remain operable through rules; complex jobs wait or receive honest fallback.

## Evaluation corpus

Create 20 representative utterances: explicit event mentions, implicit recent context, changed times, multi-action messages, no relevant event, shared task titles, privacy edge cases, acceptance/decline, sarcasm or equivocal replies (e.g. “maybe”). Grade `correct proposal | clarify | reject`, not grammatical elegance.
