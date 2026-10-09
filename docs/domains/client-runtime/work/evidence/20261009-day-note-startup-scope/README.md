# Deferred DayNote hydration verification scope

This summary belongs to the local candidate for Issue #542. The [machine-readable results](summary.json) record the measured boundaries and runtime hashes. Detailed raw logs, input manifests, synthetic fixtures and failure reproductions are retained privately. They are not included in this candidate or its Git history.

## Verified on the guarded runtime

- Fresh non-incremental application and Worker types; 45 files / 894 related hook, repository and startup tests; production build; unchanged bundle budgets.
- SDK-boundary mock: three fixture sizes and 51 phase comparisons. Consumed collections, schedule/recurrence projections and persisted stores agree. Cold collection queries decrease from 9 to 8; returned fixture documents decrease from 64/559/5,509 to 60/519/5,109.
- Real Firebase SDK 12.12.0 using Node gRPC and isolated Firestore Emulator 1.20.2: three fixture sizes and 21 core-phase comparisons. Cold query targets decrease from 9 to 8 and document responses from 69/564/5,514 to 65/524/5,114. Final normalized data, persisted approved plans and note digests agree.
- A first offline note save rejects with unread notes still `null` and zero write requests. After reconnect, confirmed server hydration preserves the existing note ID through save, independent server read and hook reload.

The Emulator fixture includes five already-saved approval plans, which explains its larger totals than the mock. It exercises approval replay, not first-creation approval. Neither transport messages nor logical calls measure billed reads. First explicit note use pays the deferred owner-wide note query, returning 4/40/400 fixture notes; whole-session savings and startup latency have not been measured.

## Data-safety contract

Unread notes are `null`, never an authoritative empty array. First explicit use and first save use the existing read-repair coordinator, owner/epoch guards and singleflight. The save waits before obtaining its mutation ticket and chooses its ID from an accepted current snapshot. Deferred Firebase hydration requires confirmed server data until first accepted readiness on every note-read entry path. A server-confirmed empty query is valid; cache-only, unknown-source and pending-write results cannot authorize initial hydration.

This intentionally requires connectivity for first note use in each deferred owner epoch, even when a previous epoch left warm cache. Default/eager repository reads and reads after first readiness retain their prior behavior. The first-use path adds no full-planner refresh or timetable-normalization write. Existing limits for untagged producers and cross-client conflicts are unchanged.

## Incomplete gates and limitations

The complete global suite is not established on the final guarded source. An older pre-guard attempt was cancelled with exit 130 after three 5-second timeouts. Same-budget isolated comparison reproduced a before-commit timeout on unchanged main, while an unchanged cleanup case straddled the 5-second limit. No assertion, timeout or AI implementation was relaxed; these observations do not establish a full pass or definitively attribute every timeout to infrastructure.

Full browser, Firestore/security and other applicable exact-head CI gates remain release requirements. The early App consumer probe used real control/prop wiring with child views stubbed; it does not prove browser/device behavior. Production billing, physical-device latency, first-creation approval and full cross-client conflict safety are unverified.

All measurement data is synthetic. Emulator execution used a fixed demo project, isolated local connections and unchanged Rules. No production data, provider call, production Rules/schema, remote branch or deployment was changed for these checks. Publication and merge remain separate approval steps.

## Reproduction

Use the existing `scripts/performance/measure-firestore-read-load.mjs` against baseline `1207f1a842a59ca958b2a497a868b10a2d82770f` to reproduce the checked-in mock workflow. The focused deferred-note, note-read recovery and repository-authority tests remain part of the candidate. The private raw evidence records the exact Emulator runner and input hashes; no machine-specific execution paths are necessary in this public document.
