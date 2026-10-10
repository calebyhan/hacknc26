# Sources and provenance

This pack was authored using user-provided HackNC information and publicly available provider documentation as of **2026-10-10**. Product details are **design proposals**, not claims that implementations already exist. Provider versions, pricing, permissions and entitlements can change; verify at implementation time.

## User-provided requirements (in conversation)

- HackNC judging: impact, functionality/quality, creativity, technical complexity, presentation.
- HackNC tracks: General required; Photon sponsor definitely selected; others only if genuine fit.
- Photon sponsor guidelines: integrate Spectrum; vision/craft/depth/traction; human collaboration, contextual memory, thoughtful fallback.
- User direction: Rally is group event and casual planning; iMessage **main UI**; iOS app primarily contact selection/project setup/progress; weather awareness and task coverage; Apple Silicon Mac, Claude Code subscription; free/low-cost infrastructure.
- Uploaded `hackathon_winning_patterns_2026(2).json`: favors algorithmic transformation, agent action, verification, and memorable demo over generic LLM wrappers.
- Uploaded previous Photon sponsored winners notes: examples of domain-specific iMessage agents and external integrations; distinguish user-provided research from fully independently audited prize results.

## Direct provider documentation

- Photon Spectrum: https://photon.codes/docs/spectrum-ts/introduction
- Photon / Convex release: https://photon.codes/blog/your-convex-agent-can-text-now-using-photon
- Official package: https://www.npmjs.com/package/@spectrum-ts/convex
- Photon plans and number types: https://photon.codes/pricing
- Claude Agent SDK subscription policy (updated Oct 7 2026): https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- Claude Code subscription and key-precedence warning: https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
- Convex Swift overview: https://docs.convex.dev/client/swift/overview
- Convex Swift quickstart: https://docs.convex.dev/quickstart/swift
- Convex auth/security practices: https://docs.convex.dev/understanding/best-practices
- Convex internal functions: https://docs.convex.dev/functions/internal-functions
- Convex durable scheduling: https://docs.convex.dev/scheduling/scheduled-functions
- Convex cron jobs: https://docs.convex.dev/scheduling/cron-jobs
- Convex Free limits: https://docs.convex.dev/production/state/limits
- Apple Contacts privacy: https://developer.apple.com/documentation/contacts/accessing-the-contact-store
- Apple Contact picker: https://developer.apple.com/documentation/contactsui/cncontactpickerviewcontroller
- Open-Meteo: https://open-meteo.com/en/docs

## Specific externally grounded notes to recheck

1. Photon Pro currently lists shared numbers and direct messaging; Business lists dedicated numbers and full group-messaging API.
2. `@spectrum-ts/convex` advertises verified/durable inbound events plus batching and paced sends. Match actual version's signatures.
3. Claude Agent SDK/CLI may still use subscription limits per Oct 7 2026 help-center update; exact authorization and rate limits depend on account and use.
4. Convex Swift client supports reactive subscriptions, but its authentication setup has to be selected and integrated.
5. Apple contact picker can return only explicitly chosen contacts without full-book read access.
6. Open-Meteo is free for noncommercial usage subject to terms and limits.

## Citation note

These URLs are for coding agents to verify source behavior, not implicit authorization to scrape user data or incur charges. Do not claim paid access, a dedicated Photon number, or permission to message contacts solely from this handoff.
