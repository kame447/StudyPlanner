# Avoid re-reading acknowledged announcement receipts

Status: local implementation and focused verification passed; combined full verification and publication remain separate
Owner: Issue #542; announcement behavior remains owned by the support domain
Branch: `perf/announcement-receipt-reads`
Base: `729d212c982bb30f4db070f4b13b6e5beb4d9923` / tree `1b1c25eafc2356e573ffd3f829b38639ce169b7f`

## Preflight and decision

On 2026-10-15, read the complete AGENTS policy and its latest #694 addition, current main, Issue #542 and its latest comments, all 19 open pull requests and both pages of branches. Existing #646/#651/#671 announcement work and #623 projection reads are merged. No current PR owns this new narrow optimization. Reuse #542 rather than creating another Issue; the previously merged branches are not resumed. Local ownership is recorded here before implementation because external writes are outside this task's authorization.

Three candidates were considered:
- Planner navigation/repeated full refresh: normal navigation already retains the planner snapshot. No new redundant load was established; preserve existing owner and recovery barriers.
- Class-detail reopen cache: its server read protects external edits and deleted-class state. A new freshness/cache contract would add risk; do not change it.
- Announcement receipt refresh: the existing owner-bound Home session retains monotonically confirmed acknowledgements, but its next foreground/page read queries those same receipt documents again. The Rules prohibit deleting receipts or moving their timestamps backwards. Filter only the receipt lookup inputs by that existing evidence; retain the fresh publication page and summary reads. This is the selected candidate.

## Scope and safety

Only the unread hook's query inputs change. No extra cache, new deadline, date cutoff, server query/schema/Rules change, additional read serialization, write replay, or planner/streak change. A newly published timestamp (including a one-nanosecond change) stays eligible. Unknown receipts and newly acknowledged receipts from another device must still be read. Each new owner/session starts with empty evidence. Every summary read remains server-required; its failure must not silently return success.

## Verification plan and stopping point

Exercise the real hook and announcement service using a deterministic Firestore SDK-boundary mock; compare identical publication/receipt fixtures and operations before and after. Measure SDK query calls, direct document reads and returned document counts separately, never call these production billed reads. Cover continuation pages, bulk and individual ACKs, republished revisions, unknown receipts, permission failure, concurrent requests and owner exit/switch/remount. Run focused hook/page/service/domain tests and fresh type/build feedback. The integration owner owns the combined full verification; publication, production billing and native browser proof remain separate.

Next: hand the exact local commit and evidence to the integration owner for combined full verification. No new Issue/PR or remote branch was created. Keep the local implementation branch until disposition; no branch deletion is required by this handoff.


## Result and measurement

The hook now requests individual receipts only for announcements not already covered by its owner-session evidence. The unchanged service still refreshes the bulk watermark in parallel with the remaining receipt query, including when that query is empty. Publications, cursor completeness, five-minute refresh policy, in-flight sharing, explicit retry, and receipt merges are unchanged.

| Synthetic operation | SDK query calls before → after | Direct summary calls | Returned documents before → after | Receipt documents before → after |
| --- | ---: | ---: | ---: | ---: |
| Initial page, 25 individual receipts | 2 → 2 | 1 → 1 | 50 → 50 | 25 → 25 |
| Same-owner refresh, 25 known receipts | 2 → 1 | 1 → 1 | 50 → 25 | 25 → 0 |
| Refresh, 20 known plus 5 newly acknowledged remotely | 2 → 2 | 1 → 1 | 50 → 30 | 25 → 5 |
| Older continuation, covered by bulk watermark | 2 → 1 | 1 → 1 | 6 → 6 | 0 → 0 |
| One revised publication, one nanosecond newer | 2 → 2 | 1 → 1 | 51 → 27 | 25 → 1 |

Returned documents count only existing documents returned by the mock; an absent summary is still one direct read call. Removing an empty receipt query can matter even though its returned count was zero. These numbers do not measure network requests, billed reads, rule-dependent charges, production occurrence frequency, or elapsed user-visible latency. The first cold read remains unchanged. An unfamiliar owner and a later new session of the same owner still perform the original complete page receipt lookup.

## Evidence behind reuse

- The only production caller of the hook's acknowledgement callback is [AnnouncementsButton](../../../../src/components/AnnouncementsButton.tsx), passing it to [AnnouncementsPage](../../../../src/components/AnnouncementsPage.tsx). Individual read line 58 awaits `markAnnouncementRead` before the callback at line 60; bulk line 73 awaits `markAllAnnouncementsRead` before line 75. Their failure paths publish no acknowledgement. The existing page tests explicitly cover pending individual persistence, failed bulk persistence, and successful retry.
- [announcementService](../../../../src/services/announcementService.ts) lines 93–109 awaits each Firestore transaction and validates the owner again after completion. A transaction that finds an equal/newer existing receipt is already confirmed evidence. No optimistic or failed write result is newly accepted.
- [Firestore Rules](../../../../firestore.rules) lines 239–252 restrict receipts to the owner, require `through >= resource.data.through` and individual `publishedAt >= resource.data.publishedAt`, and prohibit deletion. The client already merges this evidence monotonically; this patch changes only which redundant receipt documents are fetched.
- The hook creates a new session on owner change, rejects inactive/old callbacks and checks liveness before and after each read. A → B → A and unmount/remount tests confirm that old evidence is not reused across those scopes. An unchanged fresh summary read still detects authorization/read failure.

## Exact local verification — 2026-10-15

- The same final 9-case SDK-boundary test on unmodified base runtime failed 7 read-count assertions and passed the 2 owner controls. On the candidate all 9 passed; the full focused group passed **42 tests / 7 files**, exit 0. No existing assertion or timeout changed.
- The first draft test harness did not await dynamic service-module readiness and sometimes inspected `unknown` before the initial request settled. It was corrected by joining the existing in-flight page promise; original failed logs remain separate. The final baseline and candidate use identical corrected test bytes. This was a harness failure, not an application change.
- Final commands: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/hooks/useAnnouncementUnread.receiptReads.test.tsx src/hooks/useAnnouncementUnread.test.tsx src/hooks/useAnnouncementsNavigation.test.tsx src/services/announcementService.test.ts src/features/announcements/announcement.test.ts src/components/AnnouncementsPage.test.tsx src/components/AnnouncementsButton.test.tsx --maxWorkers=2 --minWorkers=1 --no-cache`; `DEV_LAN_HOST=127.0.0.1 npm run typecheck:app:full`; `DEV_LAN_HOST=127.0.0.1 npm run build`. All exit 0; build 6.30 s. No lint script is configured. Existing large-chunk warnings remain.
- All **2,775 source inputs** and **19,305 installed files**, Node/platform identity were unchanged before/after that final sequence. The canonical JSON source-manifest digest was `661a7632787c109a62117b5bb96acb09b6178eb46a19afe42019a7a6f18ad50f`; installed-file-manifest digest `0c778641998561420e6fcca9f9f398834f9933705fa2ecf97bfe327636be3c1d`. Only this checkpoint documentation was finalized afterward; runtime/test/config/dependency bytes are unchanged.
- Node v24.19.0, React/react-test-renderer 18.3.1, Firebase 12.12.0, TypeScript 5.9.3, Vite 6.4.3 and Vitest 3.2.7. Candidate hook SHA-256 `89241af52f961fb2b39ae61a693616822046925a3a327ff9765a261c1383a0c6`; new test `0dda791aa663a18bd9dc5c7797fa5337e0e6598d2d77904aa70f774b2d0a5094`.
- At 20:31 UTC main remained `729d212c`, with 19 open PRs and none overlapping announcements/receipts. Root independently inspected the hook, service, monotonic merge and owner boundaries without finding a blocker. The exact combined full app/Worker/test/build verification belongs to the integration owner. New Emulator/native-browser/production/billing evidence is not claimed; no production Firestore or live AI was invoked.

## Authorized integration checkpoint — 2026-10-16

The owner approved publication and verified-in-order main integration. The existing implementation branch `perf/announcement-receipt-reads` is reused. This cumulative candidate preserves the earlier accepted batch changes and current main `729d212c`; only this unit's original patch and documentation indexing are added. Final exact-content verify, applicable CI/browser results, main integration and public asset verification are owned by the single release coordinator. Existing capacity-budget failures remain separately deferred without threshold changes. Physical-device behavior and production performance remain unverified.
