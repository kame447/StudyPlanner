# Announcement module failure recovery

Status: local repair and focused verification complete; integration/browser gates pending

- Follow-up: Issue #542; prior announcement PRs #646/#651/#671 are merged.
- Branch: `fix/announcement-load-recovery`
- Base/HEAD: `7f953920c830ce88ad54b281c339656e21c3f79b`
- Ownership: the 2026-10-17 06:02 eligible-work audit checked fresh main, open PRs, remote heads and #542's latest comments; no same-scope owner was found. This is separate from the frozen local Admin recovery candidate and the pending released-work follow-ups. Current AGENTS matches the freshly read base instructions.
- Scope: reproduce rejected AnnouncementsPage delivery in the actual App/root with Home/history mounted. If it escapes, retain Home and owner-qualified announcement navigation with a local error boundary, using existing dialog/close patterns. No global boundary framework, ordinary announcement data/read error changes, spinner restoration, Admin changes or external writes.

## Alternatives to disconfirm

1. A rejected lazy announcement import unmounts the entire root: suggested by Suspense-only entry and no enclosing catcher; verify through actual ApplicationRouteRoot/LaplanceAppRoot/App.
2. Existing page data-load catch handles this failure: falsified if page code never mounts and the error escapes before its load function runs.
3. Root history recovers after a lost announcement page: falsified if unmount removes route subscriptions and Back cannot restore Home.

The selected scope requires cached failure/reopen, browser Back/Forward, owner change, close/Escape/focus and unaffected successful lazy loading evidence. Native local browser launch remains permission-blocked and must not be retried or bypassed; browser definitions can be prepared for the integration owner's ordinary CI.

## Baseline reproduced (2026-10-17 06:06 UTC)

A controlled rejected AnnouncementsPage import under the real ApplicationRouteRoot, LaplanceAppRoot, App and HomeTopbar removes the entire React tree. The data/bootstrap, unrelated Home body and streak/weekly services are synthetic; the ancestor roots, header/bell, announcement history and unread hook remain real. All popstate subscriptions are removed during passive unmount cleanup, and dispatching Back afterward does not restore Home. No reload or sign-out occurs. The first baseline fixture lacked the User username field; after completing the fixture, the actual failure reproduction passes. No production source changed for this proof.

The page's own data-fetch catch cannot run because its module never resolves. A local boundary around only the optional page is selected over a global root catcher or automatic reload. It will retain the already-mounted Home and bell, use an initial-style native dialog with the existing history Back action, and keep the current silent pending state. No new module-cache retry is promised. The native dialog follows the existing announcement/color-picker showModal/close pattern so focus can return to the bell.


## Implemented boundary

Only the optional page is wrapped, keyed by the account. The Home/header/bell and the existing announcement navigation/unread owners remain mounted. When delivery rejects, a small native dialog shows the failure and the existing owner-qualified Back action. Escape delegates to the same action; repeated Back requests retain the existing pending-close guard. Unmount closes the dialog using the established native focus-restoration pattern. The silent Suspense fallback remains `null`, and successful page delivery is unchanged.

The fallback uses only already-loaded shared modal styles plus a scoped rule in the existing bell stylesheet. Its explicit `dialog.announcement-load-failure` selector wins over later `.modal-card` geometry. A focused source guard protects that specificity/declaration contract; it is not a rendered-browser proof. The optional full announcement stylesheet is not made eager. No automatic reload, new retry loop, read acknowledgment, shared boundary framework, or navigation-hook policy is introduced. The cached rejected import still fails honestly if reopened; Home remains usable.

## Verification checkpoint (2026-10-17 06:12 UTC)

- Actual-root baseline reproduction: rejected import removes the tree and all root/history popstate subscriptions; one case passed as a failure demonstration. The retained baseline test copy and log are outside the final desired-product tests.
- Focused runtime/navigation/owner tests: 14 files / 101 tests passed (exit 0), including the actual-root recovery cases, a pending Back/owner-change/late-rejection case, successful quiet lazy loading, read/cache isolation, public/root behavior and existing AI leave handling.
- Additional announcement domain/service/admin/style boundaries: 4 files / 20 tests passed (exit 0). Total focused evidence: 18 distinct files / 121 tests. Native focus restoration is asserted by prepared browser tests; renderer tests verify showModal/close/focus calls and retained Home identity.
- Fresh exact-final `npm run typecheck:app:full` passed (exit 0), including the final source-cascade test; evidence is recorded in `typecheck-app-final.log`. No shared dependency, test harness or workflow changes.
- Production browser spec: JavaScript and stylesheet delivery failures in light/dark retain the document, persisted planner data, Home, Back/Forward and native dialog focus; a pending delivery case leaves silently and rejects after Back. The five cases are selected by ordinary Chromium and all four cross-browser projects (20 definitions collected). No native local launch was retried, and no native pass or rendered-layout result is claimed.
- Runtime identity: Node 24.19.0 / execution timezone Asia/Tokyo, React and renderer 18.3.1, TypeScript 5.9.3, Vitest 3.2.7, Vite 6.4.3. Canonical recovered dependencies; lock SHA-256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`; installed lock SHA-256 `6964e32dd8cfa9e3912b31f4b53858df2c99d7f2cd45f15bc0c069190de37940`.
- Exact code/test/style inputs, command results and the final local commit are pinned by `/workspace/shared/laplans-announcement-load-evidence-20261017/` receipts.

Independent review verified all nine frozen input hashes and found no remaining blocking source defect. The initial modal-cascade concern was resolved by the scoped selector and focused source guard. Only this checkpoint wording changed after review.

Next: local commit handoff to the integration owner. Before publication, the final combined content still needs full `npm run verify`, production build and native browser/visual acceptance. No upstream/main write, branch deletion, production account or production API was used.
