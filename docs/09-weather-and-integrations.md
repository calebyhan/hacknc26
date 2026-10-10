# Weather and other integrations (P1/P2)

## Weather: recommended first external integration

Use Open-Meteo forecast API with explicitly provided/geocoded event location; fetch hourly precipitation probability for the actual event window. Show forecast timestamps and source; weather forecasts are uncertain, and thresholds are organizer-selected.

Potential policy shape:

```json
{
  "enabled": true,
  "condition": "precipitation_probability_gte",
  "thresholdPercent": 60,
  "leadTimeHours": 24,
  "alternative": { "type": "indoor_backup", "location": "Union meeting room" }
}
```

Implementation: Convex scheduled internal action or cron → check upcoming opted-in weather-sensitive events → rate-limit requests/cache weather by location/window → fetch Open-Meteo → save observation → only notify when a threshold is crossed with sufficient novelty (hysteresis) and appropriate lead time → ask organizer approval → begin a new replanning proposal if chosen.

**Demo:** use a test-only event/synthetic weather signal with explicit UI/test labeling so judges can see the trigger immediately. Also show an actual live API weather observation as verification of integration if connected. Never claim fabricated forecast values are live.

## Calendar

Do **not** require Google Calendar in P0. If implemented, demand OAuth consent, least-privilege scopes, revocation path, refresh token handling, and per-user visibility. Prefer creating an event draft or authorized calendar write after user approval. Do not pretend contact selection grants calendar access.

## Flyer/screenshots

Treat image understanding as P1. Accept an image → extract date/location/event type using the chosen multimodal model or OCR tool → show a summary for confirmation; no autonomous event creation from uncertain extraction. The Claude worker might accept images depending on chosen SDK/model capabilities and supported Spectrum attachment handling; verify end to end before committing scope.

## Integration design

Define each tool as:

`ToolSpec { name, requiredRole, requiredConsent, inputsSchema, outputsSchema, sideEffectType, timeout, retryPolicy }`

Tools return structured, source-labeled observations. Agent proposals reference verified tool outputs; all writes go through trusted Convex mutations. Prefer one working integration to five half-finished ones.

## Sources

- https://open-meteo.com/en/docs
- https://github.com/open-meteo/open-meteo
- https://docs.convex.dev/scheduling/cron-jobs
