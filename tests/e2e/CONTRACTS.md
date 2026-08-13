# Browser regression contract rules

These browser tests are intentionally conservative about what they declare to be product truth.

- User-visible behavior and explicit product intent outrank current implementation details.
- Existing unit tests, current code, historical commits, and architecture documents are evidence, not individually authoritative specifications.
- When those sources disagree, do not encode the disputed behavior as a browser contract until the intended behavior is resolved.
- Browser tests should assert observable outcomes and external callback boundaries, not CSS classes, internal metadata layouts, reducer implementation details, or exact callback counts unless those details are themselves externally meaningful.
- An action that must be non-actionable may legitimately be absent, hidden, or disabled. Do not require a particular mechanism unless that mechanism is itself an accessibility or product contract.
- Exact prose is a browser contract only when the wording itself is product behavior. Do not couple layout, lifecycle, or persistence tests to unrelated status-copy text merely because it is currently visible.
- Race tests use explicit harness gates. They must not encode product latency requirements through arbitrary sleep durations.
- The lightweight QuickEntryModal harness exercises the real component but not the complete weekly-planning application lifecycle. A green harness test must not be treated as proof that `useWeeklyPlanningApplication` persistence, revision, idempotency, or stale-result handling is correct.
- Major lifecycle guarantees should be covered through the real application boundary when a test-only browser seam is available; until then, keep the harness assertion limited to component behavior.
- In the real weekly-application harness, the AI/runtime result and external persistence boundaries may be stubbed, but the deterministic application/controller/reducer/storage/approval lifecycle under test must remain production code.
- Red tests are allowed when they express an independently supported product contract. Red tests are not evidence that production is wrong when the contract itself is ambiguous.

## Supported cross-midnight and duration behavior

Quick Entry represents a scheduled plan with one calendar `date` plus `startTime` and `endTime`; it has no separate end date. The clock-time model interprets an end clock earlier than the start clock as the following day, while equal start/end clocks represent zero elapsed minutes. Consequently, a positive Quick Entry duration is representable only while it is less than 24 hours.

The supported duration range for this Quick Entry clock model is therefore `1..1439` minutes. A plan beginning at `23:30` with a 60-minute duration preserves that duration and ends at `00:30` on the following day. A 1439-minute duration is still representable; a 1440-minute duration is not, because it would collapse to the same start/end clock and become indistinguishable from zero duration.

Repository history directly supports this for both scheduled plans and actual records. Commit `c3852e459d3e441d8a2373478892af16bc12a98c` changed `resolveQuickEntryEndTime` from same-day clamping to modulo-24-hour calculation when `0 < duration < 1440`, changed actual-record calculation to the same cross-midnight rule, and changed `minutesBetween` so an earlier end clock means the following day while equal clocks mean zero. The same commit also changed the user-facing invalid-duration explanation to require a duration shorter than 24 hours.

Later same-day clamping or tests that encode `23:30 + 60 = 24:00` conflict with that model and must not silently redefine the browser contract.
