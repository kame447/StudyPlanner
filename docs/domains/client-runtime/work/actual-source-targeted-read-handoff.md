# Targeted Actual source preparation

Status: locally verified candidate; publication and combined integration pending
Owner: Issue #542 read-load follow-up, separate from #164 startup
Branch: `perf/actual-source-targeted-read`
Base: `a808d12bff49dbdd235679bfb5c29ba1dfb72531` (frozen approved release5)
Verified: 2026-10-17, exact content hashes in the local receipt and below

## Scope and decision

Saving a linked Actual previously read every canonical schedule for its owner to resolve one source. The canonical Firebase authority now optionally queries `userId == owner` and `provenance.legacy.id == sourceId`. The facade selects the new link ID, or the previous link ID when unlinking. It still uses the existing provenance resolver, material-save route and final write transaction. Local authority implementations and legacy rollout fallback retain the full snapshot path.

Three alternatives were compared: retain the complete scan (unchanged but grows with every schedule); derive canonical document IDs (ties reads to document naming rather than stored provenance and must cover both kinds); query owner plus persisted source identity (selected). No date, kind, occurrence-admission filter or row limit is added. Both Plan and MonthEvent projections and complete recurrence/overrides remain available. Plan precedence is preserved even for an excluded or nonoccurring date. No historical or recurring records are removed or truncated.

The lookup is performed for every preparation and adds no cache. It preserves existing `getDocs` cache semantics, rather than promising a server-only confirmation. Deleted-source snapshots, legacy orphans, unlinking, explicit relinks, caller-snapshot rejection and missing-new-source reload errors retain their existing domain rules. Canonical query/projection errors propagate; they never trigger a legacy fallback. Owner assertions and Firestore Rules remain unchanged.

Partial source rows do not begin or publish complete-history receipts. The existing production mutation wrapper still invalidates full-history evidence before preparation and after settlement; pending-save tests cover both ordinary and material routes. This does not change post-save streak refresh or source-change atomicity across clients.

## Evidence

- Controlled composed-repository fixture: one linked source among 1,000 schedules. Before and after each issue four SDK query calls, including one source query. Source and total returned query documents change from 1,000 to 1; saved results match. The migration-marker direct read, transaction calls and other SDK operations are outside this query metric. These are synthetic response counts, not measured Firestore billed reads, latency or production savings. If all schedules share the selected identity, this lookup can still return all of them; it has no constant-size limit.
- Baseline assertion failed as intended against the unchanged full-read implementation. The new composed test matrix compares both save routes over 23 source scenarios, plus owner, same-ID duplicates, receipt, pending mutation, source refresh/deletion, denial and legacy fallback boundaries: 57 new tests pass. Arbitrary canonical document names and duplicate provenance fixtures establish adapter read compatibility, not writes permitted by current Rules.
- Focused verification: nine files, 184 tests passed, including prior Actual preparation, authority/facade, provenance lifecycle, source preservation and confirmed-history regressions.
- Real SDK and unchanged owner Rules on loopback `demo-studyplanner`: 13/13 passed. Ten prior tests remain; three new cases cover both source kinds sharing an identity, old recurrence/excluded dates, foreign/missing source queries, no partial receipt, and changed/deleted source saves through ordinary and material APIs. Server read-back proves rejected new/relink saves leave stored records unchanged.
- Fresh nonincremental app typecheck and production build passed. Build retained the existing large-chunk warning. No UI behavior changed; browser tests and the full integration suite were not duplicated here.
- Independent domain review checked 1,344 source-selection combinations; exact runtime and final unit/Emulator diff review found no blocker and independently checked the terminal logs. The initially mislabeled nonoccurring-Plan test was corrected and given an explicit Plan-precedence assertion.
- Initial boundary verification had three incorrect test expectations (`study-plan` rather than the existing `study` kind). The current domain contract established the correction; all affected assertions now pass. Initial failure logs are retained.

## Limits and index readiness

Relevant source validation remains intact. There is one intentional isolation difference: malformed recurrence in an unrelated same-owner schedule previously made whole-snapshot conversion throw; a selected-source save now succeeds. The new test proves malformed selected recurrence still fails before writes. Rules only validate recurrence rules as a list, so unrelated malformed rows are possible; equivalence is not claimed for arbitrary corrupted unrelated data.

This two-equality query uses default single-field index merging. The repository has no field exemptions (`fieldOverrides: []`), so no new composite index is proposed. This is based on the [official Firestore index documentation](https://firebase.google.com/docs/firestore/query-data/index-overview#queries_supported_by_single-field_indexes), not Emulator enforcement. Production-side index overrides/readiness have not been independently inspected. No production query, index deployment or billing experiment was performed.

Fresh ownership check at 03:40 UTC found no competing current PR/branch/owner; main remained `9abc4603`, 190 remote heads and 27 open PRs were unchanged. Completed #623 partial kind-query work and closed #683/#712 source/owner contracts were checked. The publisher's frozen release5 worktree was not changed.

Runtime SHA-256:
- `firebaseScheduleEventAuthority.ts`: `1e583c098c5f1ba7454095b8f57ac8bb75b96aee88bde7e596fddd0234801095`
- `scheduleEventAuthorityRepository.ts`: `5d1be3b8464643357934d54dccd5cfaa3a3641511e07b15518365201797f0434`

Local evidence: `artifacts/actual-source-read/{baseline,boundaries,focused,typecheck,emulator,build}.log`, receipt and patch. Exit criteria for this slice are local focused verification, real-SDK owner/absence/source continuity coverage, independent exact-diff review and a durable receipt. Publication/main changes require the separate release decision; any later integration must verify its own exact content.
