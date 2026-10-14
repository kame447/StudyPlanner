# DayNote startup read scope

Status: local verification snapshot; scoped checks passed; the owning pull request tracks current global release gates and publication.
Owner: existing Issue #542; #437 / PR #472 freshness and #164 storage contracts remain applicable
Base: main `1207f1a842a59ca958b2a497a868b10a2d82770f`
Active local review branch: `perf/deferred-daynotes-review`
Updated: 2026-10-09 UTC

## Outcome

The current App does not consume daily-note state or its save callback. Its initial bootstrap now leaves notes explicitly unread (`null`) and omits that one collection query. Explicit full reads retain their contract. First explicit note use or first save hydrates through the existing note-repair group, with owner/epoch fencing, same-owner singleflight and accepted-ready checks. The save waits before mutation admission and uses the current accepted note ID. This adds no full-planner refresh or timetable-normalization path.

The implementation changes the two existing app/data hooks and adds a backward-compatible repository read option with a Firebase-only server-confirmed branch. No new capability framework, schema or Rules change is introduced. Historical schedules, recurrence and stored notes are not period-limited or discarded.

## Initial offline safety

A real-SDK probe found that the initial draft could accept an empty offline cache even with four notes on the server. The guarded implementation requires confirmed server data on every deferred first-hydration path, including explicit full reads, demanded bootstrap retries and repair. Until accepted readiness, cache-only, unknown-source and pending-write query results cannot authorize note use or save. Server-confirmed empty is valid.

The corrected SDK probe rejects the first offline save with notes still `null` and zero writes. Reconnect, confirmed read, existing-ID save, independent server read and hook reload retain all four notes. First note use in each deferred owner epoch therefore requires connectivity even with a previous warm cache. Default/eager behavior and post-hydration reads retain their prior behavior.

## Verification

- Fresh non-incremental application/Worker types, 45 files / 894 related hook/repository/startup tests, production build and bundle budgets passed on the guarded runtime.
- Three-size SDK-boundary mock: all 51 phase comparisons agree for consumed data, schedule/recurrence projections and persisted stores. Cold collection queries decrease 9→8 and returned fixture documents 64→60 / 559→519 / 5,509→5,109.
- Three-size real Node SDK / isolated Firestore Emulator: all 21 core-phase comparisons agree for final normalized data, persisted approved plans and notes. Cold targets decrease 9→8 and document responses 69→65 / 564→524 / 5,514→5,114.
- The Emulator fixture contains five already-saved approval plans; it covers replay, not first-creation approval. First explicit note use pays the deferred owner-wide query (4/40/400 notes). No whole-session billing or device-latency reduction is inferred.

All fixtures are synthetic. Detailed raw evidence and exact input manifests are retained privately. The [public verification scope](evidence/20261009-day-note-startup-scope/README.md) and [summary with runtime hashes](evidence/20261009-day-note-startup-scope/summary.json) retain results, definitions and limitations without machine-local paths or diagnostic source archives.

## Remaining gates

A complete global unit pass is unestablished on the final guarded runtime. An older pre-guard run was cancelled with exit 130 after three 5-second timeouts. Same-budget comparison reproduced one timeout on unchanged main and put an unchanged cleanup test near its time limit. Neither assertion nor timeout nor AI implementation was changed. This is a verification limitation, not a full pass or a proven cause for every timeout.

The early App consumer probe used real control/prop wiring with child views stubbed. It does not establish actual browser behavior. Full browser/WebChannel, physical-device startup latency, production billing, full Rules/security CI, first-creation approval (#51) and full cross-client conflict safety remain separate. Existing untagged-producer and cross-client concurrency limits are unchanged.

Next: finish bounded real-browser acceptance, record its exact scope separately, and obtain applicable exact-head CI results before release readiness. This local verification did not change a remote branch, production data, provider behavior or deployment. The owning pull request records subsequent authorized publication and release.
