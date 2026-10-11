# Rally: two people, two-minute demo

**Pitch:** Rally turns separate iMessage conversations into one shared event plan. It remembers who agreed to what, asks before changing commitments, and keeps the organizer and participants aligned.

**Caleb:** organizer, presenter, phone A. **Yewon:** participant, presenter, phone B. Both use their own 1:1 conversation with Rally. The iOS app is the shared status view.

This is a planned live walkthrough, not a transcript of a completed run. Human messages below are copyable; Rally messages are expected replies from the current implementation. Dates, deadlines, names, ordering of notifications, and readable offer references can vary. Use the actual reference Rally supplies when it differs. No simulated delivery or model output is presented as live.

## The story and starting state

You are organizing an event. Setup needs two people. Caleb has already volunteered for Setup; Yewon has accepted Speakers. Caleb asks Yewon to join Setup too. Rally notices that her two tasks overlap, asks her to explicitly confirm, and then updates both people's view.

| Task | October 18, 2026, Eastern | People needed | Before the timer | After the demo |
|---|---|---:|---|---|
| Setup | 1–2 PM | 2 | Caleb, 1/2 | Caleb and Yewon, 2/2 |
| Speakers | 1:30–2:30 PM | 1 | Yewon, 1/1 | Yewon, 1/1 |

Use **Rally Demo 1018 A** as the event name. For another rehearsal, change the suffix everywhere; for another date, change the full date everywhere. All event/task times must still be in the future. Use the participant names actually shown in STATUS if they differ from Caleb and Yewon.

## Before going on stage

Allow 10–15 minutes for preparation. Finish all setup and initial acceptances before starting the two-minute timer.

1. Keep the Mac awake and connected. Run `npm run worker:status` in the repository; confirm the worker is online with no reported error. The owned background worker may already be running—check before starting another copy.
2. Open each person's real Rally iMessage conversation. Both must receive actual replies on their own phone. Yewon must personally JOIN and accept her initial Speakers offer.
3. Use the setup transcript below. Send one message at a time and wait for the next prompt. Do not paste an entire block as one message.
4. Check for old test commitments at the same time. If you choose to retire an old event you organize, send `close event <exact old event name>`, review it, then `yes, close it`. Close only the intended old event. Keep the new demo event open.
5. Open the signed-in iOS app on this exact event. Check the starting assignments against STATUS. Finish with no pending offers for Setup or Speakers.
6. Have the live request ready to paste and a previously captured real-run recording available. A recording must be described as recorded; an Explore demo screen must be described as simulated.

## Full preparation texts: both sides

### 1. Caleb creates the event

```text
Caleb → Rally: create an event
Rally → Caleb: Let's plan it. What's the event called? You can reply 'cancel setup' at any time.

Caleb → Rally: Rally Demo 1018 A
Rally → Caleb: When is it? Use a clear date and time, like Oct 18, 2026 at 2 PM. Include the year and AM or PM; I won't guess numeric dates or 'tomorrow'. I'll use your saved timezone: America/New_York.

Caleb → Rally: Oct 18, 2026 at 1 PM
Rally → Caleb: Where is it? I'll use Sun, Oct 18, 2026, 1:00 PM EDT. Send a place, or 'skip'.

Caleb → Rally: Student Union
Rally → Caleb:
  Review your event:
  Rally Demo 1018 A
  Sun, Oct 18, 2026, 1:00 PM EDT
  Student Union

  Reply "yes, create it" to schedule this event and opt in to Rally's iMessage updates for this event. You can STOP at any time. No one else is invited or assigned. Reply "cancel setup" to discard it.

Caleb → Rally: yes, create it
Rally → Caleb: Rally Demo 1018 A is scheduled for Sun, Oct 18, 2026, 1:00 PM EDT. Your event updates are on. Next, text "invite someone" or "add a task". No one is assigned yet.
```

If no timezone is saved, the date prompt says it will ask for the timezone next. The extra exchange is:

```text
Rally → Caleb: Which timezone? Reply Eastern, Central, Mountain, Pacific, UTC, or an IANA name such as Europe/London.
Caleb → Rally: Eastern
Rally → Caleb: Where is it? I'll use Sun, Oct 18, 2026, 1:00 PM EDT. Send a place, or 'skip'.
```

### 2. Caleb creates two tasks in one conversation

```text
Caleb → Rally: add a task
Rally → Caleb: For Rally Demo 1018 A, what's the task called? Tasks can overlap; each can need more than one person.

Caleb → Rally: Setup
Rally → Caleb: When does Setup start? For the event day (Sun, Oct 18, 2026, 1:00 PM EDT), send a time like 1 PM. For another day, send Oct 18, 2026 at 1 PM. Times use America/New_York.

Caleb → Rally: 1 PM
Rally → Caleb: When does it end? Send a later time like 2 PM on the same day, or include the full date for a later day.

Caleb → Rally: 2 PM
Rally → Caleb: How many people are needed at the same time? Reply with a number from 1 to 20. This doesn't assign anyone.

Caleb → Rally: 2
Rally → Caleb:
  Review Setup for Rally Demo 1018 A:
  Sun, Oct 18, 2026, 1:00 PM EDT to Sun, Oct 18, 2026, 2:00 PM EDT
  Needs 2 people. No one is assigned yet.
  Reply "yes, add it" to save, or "cancel setup" to discard it.

Caleb → Rally: yes, add it
Rally → Caleb: Setup is saved for Rally Demo 1018 A, needing 2 people. It's unassigned. Send the next task's name, or reply 'done'.

Caleb → Rally: Speakers
Rally → Caleb: When does Speakers start? For the event day (Sun, Oct 18, 2026, 1:00 PM EDT), send a time like 1 PM. For another day, send Oct 18, 2026 at 1 PM. Times use America/New_York.

Caleb → Rally: 1:30 PM
Rally → Caleb: When does it end? Send a later time like 2 PM on the same day, or include the full date for a later day.

Caleb → Rally: 2:30 PM
Rally → Caleb: How many people are needed at the same time? Reply with a number from 1 to 20. This doesn't assign anyone.

Caleb → Rally: 1
Rally → Caleb:
  Review Speakers for Rally Demo 1018 A:
  Sun, Oct 18, 2026, 1:30 PM EDT to Sun, Oct 18, 2026, 2:30 PM EDT
  Needs 1 person. No one is assigned yet.
  Reply "yes, add it" to save, or "cancel setup" to discard it.

Caleb → Rally: yes, add it
Rally → Caleb: Speakers is saved for Rally Demo 1018 A, needing 1 person. It's unassigned. Send the next task's name, or reply 'done'.

Caleb → Rally: done
Rally → Caleb: Task setup finished. Saved tasks are unchanged; any unfinished task was discarded. Text "add a task" whenever you want to add another.
```

If Rally asks which event during setup, reply with this event's exact name or its displayed number, then continue. Check the event name in every review.

### 3. Caleb invites; Yewon joins from her own phone

Replace `<Yewon's actual phone with +country code>` only in Caleb's private conversation. Do not send the placeholder literally or put the actual phone in this document.

```text
Caleb → Rally: invite someone
Rally → Caleb: For Rally Demo 1018 A, who would you like to invite? Send their name. I won't message them automatically.

Caleb → Rally: Yewon
Rally → Caleb: What's Yewon's phone, including the + country code? Formatting like +1 (555) 000-0002 is okay. I'll show only its last four digits in the review.

Caleb → Rally: <Yewon's actual phone with +country code>
Rally → Caleb:
  Invite Yewon to Rally Demo 1018 A? Selected phone ends in <last four digits>.
  Reply "yes, invite them" to create an invitation for you to share. I won't message or enroll them. Reply "cancel setup" to discard it.

Caleb → Rally: yes, invite them
Rally → Caleb: Invitation ready for Yewon. Share this yourself: "Text join Rally Demo 1018 A in your own Rally conversation to join and receive event updates." It works only from their selected phone and expires in 24 hours. I haven't contacted or enrolled them.

Yewon → Rally: join Rally Demo 1018 A
Rally → Yewon: You've joined Rally Demo 1018 A and opted in to its Rally updates. Text STATUS for assignments or STOP to stop messages.
```

Caleb shares the join instruction directly with Yewon; Rally does not send her an invitation DM. This uses an event-bound invitation, not a phone-link code.

### 4. Establish the starting assignments

`<deadline>` below means the actual local date/time and timezone in Rally's offer, normally ten minutes after creation. Accept while it is current. Natural-language inference can take several seconds; wait rather than sending the same request again.

```text
Caleb → Rally: For Rally Demo 1018 A, I can cover Setup.
Rally → Caleb: Got it. I’ll check the plan.
Rally → Caleb: Rally Demo 1018 A: Caleb volunteered and accepted Setup.

Caleb → Rally: For Rally Demo 1018 A, can Yewon cover Speakers?
Rally → Caleb: Got it. I’ll check the plan.
Rally → Caleb: Rally Demo 1018 A: Offer created for Yewon to cover Speakers. Waiting for Yewon to accept. Nobody new is confirmed yet.
Rally → Yewon: Rally Demo 1018 A: Could you cover Speakers, Oct 18, 1:30 PM–Oct 18, 2:30 PM (America/New_York)? Reply YES or NO by <deadline>. No assignment has changed yet.

Yewon → Rally: YES Speakers
Rally → Yewon: Rally Demo 1018 A: Yewon accepted Speakers, Oct 18, 1:30 PM–Oct 18, 2:30 PM (America/New_York). I've updated the assignment.
Rally → Caleb: Rally Demo 1018 A: Yewon accepted Speakers, Oct 18, 1:30 PM–Oct 18, 2:30 PM (America/New_York). I've updated the assignment.

Caleb → Rally: what's my status?
Rally → Caleb:
  Rally Demo 1018 A:
  Setup: needs coverage; 1/2 confirmed: Caleb
  Speakers: confirmed (1 accepted); 1/1 confirmed: Yewon
```

STATUS aggregates your enrolled active events, so other event sections may appear. The lines above are the section you need. If a self-volunteer produces an overlap warning, follow its separate confirmation instruction before proceeding; the starting state must actually match the table.

If the model instead turns Caleb's self-volunteer into an ordinary Setup offer, Caleb must answer `YES Setup` and follow any overlap warning. Wait for the actual acceptance notice and verify 1/2 in STATUS; the queue acknowledgment alone is insufficient.

## Live two-minute demo: all texts on both phones

Start the timer with the prepared event open. Send only this new coordination request live:

```text
Caleb → Rally: For Rally Demo 1018 A, can Yewon also join me on Setup? We need two people.
Rally → Caleb: Got it. I’ll check the plan.
Rally → Caleb: Rally Demo 1018 A: Offer created for Yewon to cover Setup. Waiting for Yewon to accept. Nobody new is confirmed yet.
Rally → Yewon: Rally Demo 1018 A: Could you cover Setup, Oct 18, 1:00 PM–Oct 18, 2:00 PM (America/New_York)? Reply YES or NO by <deadline>. No assignment has changed yet.

Yewon → Rally: YES Setup
Rally → Yewon: Rally Demo 1018 A: Setup overlaps with your Speakers. Nothing changed. To accept anyway, reply CONFIRM OVERLAP Setup by <deadline>.

Yewon → Rally: CONFIRM OVERLAP Setup
Rally → Yewon: Rally Demo 1018 A: Yewon accepted Setup, Oct 18, 1:00 PM–Oct 18, 2:00 PM (America/New_York). I've updated the assignment.
Rally → Caleb: Rally Demo 1018 A: Yewon accepted Setup, Oct 18, 1:00 PM–Oct 18, 2:00 PM (America/New_York). I've updated the assignment.

Caleb → Rally: what's my status?
Rally → Caleb:
  Rally Demo 1018 A:
  Setup: confirmed (2 accepted); 2/2 confirmed: Caleb, Yewon
  Speakers: confirmed (1 accepted); 1/1 confirmed: Yewon
```

Participant order in STATUS may differ. If the warning lists another commitment too, it must be reviewed as well. Explicit confirmation accepts the overlap; it does not move either task or solve the time conflict automatically. The core demo has one model request; acceptance, overlap confirmation and casual status are deterministic.

**Visible proof:** before YES, Setup remains 1/2. After the first YES and warning, it remains 1/2. Only after `CONFIRM OVERLAP` does it become 2/2, preserving Caleb's assignment and Yewon's Speakers assignment. Open the same event in the app and show those people/counts.

## Two-minute spoken script

Speak naturally; leave the wait windows for actual delivery. Keep both phone conversations visible and switch to the app only at the end.

| Time | Person/action | What to say |
|---|---|---|
| 0:00–0:15 | Caleb, show the prepared event | “Organizing an event usually means chasing messages and remembering who promised what. Rally keeps one shared plan through the iMessage conversations people already use.” |
| 0:15–0:30 | Yewon, show her phone and Speakers commitment | “We each have our own conversation with Rally. I’ve opted in and agreed to handle Speakers. Setup needs two people, but only Caleb is confirmed.” |
| 0:30–0:45 | Caleb, send the live request | “I’ll ask normally: can Yewon also join me on Setup? Rally knows this task needs two people, so it adds a teammate while keeping me assigned.” |
| 0:45–1:00 | Yewon, show the received offer | “It asks me directly. A suggestion stays pending until I accept it. The organizer can see we’re waiting.” |
| 1:00–1:15 | Yewon, send `YES Setup`; show warning | “I’ll say yes. Rally notices that Setup overlaps with Speakers. It pauses the change and shows me the conflict.” |
| 1:15–1:30 | Yewon, read warning and send `CONFIRM OVERLAP Setup` | “For this demo, I’m explicitly agreeing to handle that overlap. Rally needs this separate confirmation before changing my commitments.” |
| 1:30–1:45 | Caleb, show confirmation; send casual status | “Now we both receive confirmation. Setup has two people, and my original assignment is still there. I can ask ‘what’s my status?’ right in iMessage.” |
| 1:45–2:00 | Caleb shows app; Yewon closes | **Caleb:** “The app reflects the same accepted plan.” **Yewon:** “Rally turns a conversation into a shared commitment—with the people affected deciding what they’ll take on.” |

The final sentence fits whether the app is shown by Caleb or Yewon, as long as that account is signed in and enrolled in the same event. If the app has not yet updated, show the live STATUS proof and do not claim visual parity.

## Optional follow-up: actual reassignment and organizer approval

Use this after the two-minute pitch or if a judge asks how a handoff works. Starting from the completed core demo, Yewon asks Caleb to replace her on Speakers. Unlike adding a teammate, this releases Yewon's Speakers commitment only after Caleb accepts. Caleb also holds Setup, so his separate overlap confirmation is required.

```text
Yewon → Rally: For Rally Demo 1018 A, can Caleb replace me on Speakers?
Rally → Yewon: Got it. I’ll check the plan.
Rally → Yewon: Rally Demo 1018 A: Offer created for Caleb to cover Speakers. Waiting for organizer approval before asking them. Nobody new is confirmed yet.
Rally → Caleb: Rally Demo 1018 A: Approval needed for Caleb to cover Speakers. Text APPROVE Speakers. You'll then receive an offer and must reply YES separately by <deadline>. No assignment has changed.

Caleb → Rally: APPROVE Speakers
Rally → Caleb: Rally Demo 1018 A: Could you cover Speakers, Oct 18, 1:30 PM–Oct 18, 2:30 PM (America/New_York)? Reply YES or NO by <deadline>. No assignment has changed yet.

Caleb → Rally: YES Speakers
Rally → Caleb: Rally Demo 1018 A: Speakers overlaps with your Setup. Nothing changed. To accept anyway, reply CONFIRM OVERLAP Speakers by <deadline>.

Caleb → Rally: CONFIRM OVERLAP Speakers
Rally → Caleb: Rally Demo 1018 A: Caleb accepted Speakers, Oct 18, 1:30 PM–Oct 18, 2:30 PM (America/New_York). I've updated the assignment.
Rally → Yewon: Rally Demo 1018 A: Caleb accepted Speakers, Oct 18, 1:30 PM–Oct 18, 2:30 PM (America/New_York). I've updated the assignment. Your previous commitment is released.

Yewon → Rally: what's my status?
Rally → Yewon:
  Rally Demo 1018 A:
  Setup: confirmed (2 accepted); 2/2 confirmed: Caleb, Yewon
  Speakers: confirmed (1 accepted); 1/1 confirmed: Caleb
```

At the approval and warning stages, Yewon must still be assigned to Speakers. Organizer approval and participant acceptance are separate even when the same person performs both. This additional flow is outside the two-minute timing budget.

## If something takes longer on stage

- **No offer by 0:55:** keep narrating the pending state; do not resend the request. If needed, switch to the labeled real-run recording: “This is a recording of the same flow from our rehearsal.”
- **Ambiguous event/task or offer:** answer the actual numbered question or use the reference shown. Do not send a guessed confirmation against a different event.
- **Expired offer:** stop that acceptance path; a fresh request creates a new offer. Explain that old replies cannot change the current plan.
- **Connectivity/provider failure:** say the live message has not completed. A recorded demonstration is an honest fallback; a simulated screen must be labeled simulated.

## Rehearsal and evidence

Rehearse this exact route once on the actual phones before presenting, then create a fresh event for the stage run. Close the rehearsal event through its reviewed phone workflow if you want to release its commitments. Do not reset demo state by editing database rows during the presentation.

The implementation's existing tests cover guided setup/continuation, named JOIN, team staffing, preservation of existing assignees, overlap confirmation, proposal approval/reassignment, deterministic status and app reads. Local tests use synthetic messages and fake delivery; they do not certify this new script as a successful live run. Current evidence and remaining limits are in [demo readiness](23-demo-readiness.md); runtime instructions are in [deployment and operations](12-deployment-and-operations.md).

Documentation verification, October 11: source copy and date formatting checked; **70 focused tests passed** across guided phone setup, task continuation, conversation follow-ups, casual status and team tasks. No participant messages were sent while preparing this document.
