# Documentation index

| File | Purpose | Read when |
|---|---|---|
| `00-product-vision.md` | Users, value, boundaries, success criteria | Choosing product behavior |
| `01-scope-and-acceptance.md` | P0/P1/P2, precise definition of done | Planning any implementation |
| `02-architecture.md` | Service boundaries, flows, queue and worker | Scaffolding and debugging |
| `03-data-model.md` | Proposed entities, indexes, access and invariants | Writing Convex schema |
| `04-messaging-and-photon.md` | Provider mechanics, sender identity, opt-in, retries | Implementing iMessage |
| `05-agent-reasoning.md` | Claude adapter, output contract, context selection | Implementing language understanding |
| `06-workflows.md` | Invitation, confirmation, cancellation, event resolution | State transitions |
| `07-ios-companion.md` | Contact picker, onboarding, app/auth, screen scope | Implementing SwiftUI |
| `08-planning-and-reassignment.md` | Constraints, scoring, approvals | Building optimization logic |
| `09-weather-and-integrations.md` | Optional weather and integration strategy | P1 work |
| `10-security-privacy.md` | Trust boundaries, consent, abuse, storage | Every user-visible feature |
| `11-testing-and-demo.md` | Fixtures, adversarial tests, demo script | Verification and judging |
| `12-deployment-and-operations.md` | Local/cloud runtime, secrets, outage playbook | Deployment |
| `13-build-plan.md` | 24h path, workstreams, kill switches | Hackathon management |
| `14-decisions-and-open-questions.md` | ADRs and unverified dependencies | Preventing assumptions |
| `15-sources.md` | Provider documentation links and source provenance | Updating SDKs |
| `16-agent-task-board.md` | Assignable coding tickets and dependencies | Starting implementation |

## How to use

On the **first session**, a coding agent reads the mandatory list in `AGENTS.md` once. After that it should **not** reread every file on every turn: reread `AGENTS.md` and the acceptance spec, then the one or two documents relevant to the current ticket. Write changes to docs when implementation decisions change. Source-of-truth order: explicit new user direction > current tests/working code > current ADRs > proposed docs > external examples.
