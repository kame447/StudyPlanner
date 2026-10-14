# Announcement unread indicator and presentation

Status: active
Owner: announcement reader UI
Branch: `fix/announcement-unread-presentation`
Base: `fe8aa40d9e3ceb594c01f29e6f9f6d2521c69bb2`
PR: not published; publication requires separate approval

## Scope and ownership

The follow-up user request adds a Home bell mark for confirmed unread announcements and groups the existing list/detail content with theme-aware cards, category icons and restrained hierarchy. The two supplied mobile screenshots were viewed locally. Publication text remains unchanged. Existing PR #646 is merged; current open PRs and both branch-list pages contain no implementation of this follow-up. Issue #483 remains the small-UI umbrella.

Own AnnouncementsButton/Page, reader CSS, unread hook and public read helpers/tests. HomeTopbar/App and planner repositories are untouched; the streak owner retains those connections. The administrator UI owner changes AdminAnnouncementsPage and separate admin CSS. In shared announcements native tests this branch owns reader cases; administrator cases remain with that owner. No production Rules/schema or service activation changes.

## Decision and read cost

Three alternatives were checked against the actual schema: newest-only status incorrectly clears when an older item remains unread; exhaustive receipt scanning can read the full collection on startup; a bounded initial page with three-state evidence preserves uncertainty and avoids a scan. The third is selected with the root owner. The Rules limit receipt query size to 25, not stored receipt count; 26 publications therefore do not prove an unread item exists.

The initial bounded page can confirm unread or confirm clear if complete. An all-read page with continuation stays internally unknown and is never labelled fully read. Opening/paginating the list contributes evidence; successful bulk-read acknowledgement clears through its exact timestamp. Failed writes cannot clear the indicator. Newer/revised publications remain unread. Planned cache/in-flight sharing prevents duplicate startup/open reads; foreground refresh is bounded and throttled, not a polling loop or Firestore subscription. Exact cost and tests will be recorded after implementation.

## Verification and next action

Source inspection/preflight complete. No new code verification yet. Next: implement the bounded owner-fenced state and card layout, focused regressions, then one exact-content full verify. Native browser and rendered images remain unverified locally because the existing socket EPERM restriction is unchanged; do not retry that environment or substitute fixture results for physical iOS behavior.

Exit criteria: focused owner/late-result/ACK/new-revision/read-bound regressions; full fresh app/Worker types, unit/integration and build on fixed content; existing native reader cases updated for badge/layout and held for approved CI publication; root independent review; local commit and explicit publication hold.

## Implementation checkpoint — 2026-10-14 13:14 UTC

- Reader list/detail now use compact theme-token cards, category icons and separate heading/body hierarchy. No announcement text, huge empty panel or explanatory copy was added. Bell uses a small accessible mark and preserves its existing action name/focus behavior.
- The first page/in-flight promise is shared by Home and the opened list. Maximum successful check: 26 publication documents, 1 summary, 25 receipt documents (up to 52; empty queries may still incur Firestore minimum charges). No second page is requested automatically. Cache/cooldown is five minutes; only visible foreground events request a refresh, and an open reader suppresses those refreshes. Explicit list retry bypasses a failed background cooldown because no successful cache exists.
- Only persisted acknowledgements affect the indicator. Closing the page while a read is pending still updates the same-owner bell after ACK; changed-owner closures are rejected. Read snapshots merge monotonically, and new publication timestamps/revisions remain unread. An unknown older continuation is not represented as a confirmed all-read state or as a false unread dot.
- Existing public service, Rules, schema, HomeTopbar and App are unchanged. The streak owner approved one child-component mock in the existing HomeTopbar unit test; its new streak changes must be retained at integration. Shared native administrator cases were byte-compared with base and are unchanged.
- Focused: 8 files / 45 tests passed, including 10 new unread-hook tests, 2 bell tests and 2 added page acknowledgement cases. App typecheck passed. Initial test setup missed the existing DEV_LAN_HOST configuration; corrected to 127.0.0.1 without opening a browser. An early app typecheck caught boolean-returning test callbacks; callbacks were fixed, with no production workaround.
- Native: existing Admin runner discovers 10 cases (8 reader, 2 unchanged admin), including one-item mobile-light and desktop-dark render/individual-read checks. Discovery is not execution. No local browser or screenshot of the changed UI was produced; approved CI/browser evidence remains necessary.
- Root independently read the owner/session, monotonic read state, shared promise and unknown-state contracts and found no blocking issue. Next: exact-content full verify after the current administrator verification finishes, then local commit and publication hold.

## Exact local verification — 2026-10-14 13:20 UTC

`DEV_LAN_HOST=127.0.0.1 CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false DO_NOT_TRACK=1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=2 npm run verify` finished exit 0 at 13:19:35 UTC: fresh non-incremental app/Worker checks, regenerated Worker runtime types, 8,611 passed tests / 907 files, production build 5.74 s. The 54 skipped tests, 1 todo and 11 skipped files are separate. No lint script is configured. The existing optional Wrangler debug-log ENOENT and build chunk-size warning remain visible and did not prevent their stages completing.

Exact non-Markdown source identity was unchanged before/after: 2,254 files, SHA-256 `c516faa5827f003dac4da7142f14a2e385241d614ef406b078c15e3f06ca2ae1`. Installed dependency bytes were unchanged: 19,328 files, SHA-256 `c95d60244731e262caec70c797226c1722edb48612d4b1792d19fbe5cbd210ae`; Node v24.19.0, React 18.3.1, TypeScript 5.9.3, Vite 6.4.3, Vitest 3.2.7, Wrangler 4.147.0, Firebase 12.12.0 all match the lockfile. The existing J1 regression's generated old-worker tree was preserved outside the repository after the run; it is not source or a publication input. The normal configured `.cache` test exclusion was unchanged.

Latest main remains `fe8aa40d` and the open-PR read at 13:19 UTC still shows no overlapping announcement follow-up. The administrator owner confirmed the shared category-chip styling does not conflict with its new admin CSS. Local implementation is ready to commit; publication, exact native/visual execution and final rendered-image inspection remain approval-gated. No new Issue/PR or upstream update was made. Do not claim complete historical unread discovery, physical iOS verification, or production delivery from these local results.

## Integration service-load correction — 2026-10-14 13:59 UTC

Combined bundle inspection found the new static unread-hook import promoted the announcement service, including administrator write functions, into the entry chunk. The owner-approved follow-up restores a dynamic service import inside the existing asynchronous read request and checks the active owner immediately after module loading. The normal application root, query limits, cache/ACK logic, service operations and build configuration are unchanged.

A regression first failed against the static import, then passed after the correction: leaving before the service resolves starts no publication/receipt read. All 32 focused tests across the hook, bell, page, domain, service and header passed. The earlier 8,611-test full proof is pre-correction; the integration owner owns the fresh combined exact-content verification, recorded outside this branch at `/workspace/shared/laplans-ui-followups-integration-evidence/`. On the combined prototype, largest JS gzip fell from 262,024 to 260,992 bytes against the unchanged 260,000-byte limit. The remaining excess is explicitly separate from the six older budget categories; no manual chunk or normal-root loading change was adopted merely to cross the threshold.

The original worker is finished; the integration/publication owner is now the sole writer of this follow-up branch. Publication of this UI follow-up still awaits user approval, and native UI execution remains pending.
