# Same-document administrator entry

- Issue: [#542](https://github.com/kame447/StudyPlanner/issues/542); prior root/return navigation [#652](https://github.com/kame447/StudyPlanner/pull/652) is merged.
- Active local branch: `perf/admin-entry-navigation`
- Base: `9abc46038e7fb6d8dd0c26dabf31b8e251311473`
- Status: local implementation and focused verification complete; integration review, full verification and native browser acceptance remain separate. No new Issue/PR or upstream write.

## Ownership and scope

At 20:21–20:22 UTC on 2026-10-16, main, all 27 open PRs, 33 open Issues, 190 remote branches, related closed PRs and the latest #483/#542/#213 comments were checked. No active owner covers incoming My Page → Admin navigation. The former `fix/admin-mobile-navigation` is merged. This local task owns only same-document Admin entry and its existing leave/access/history boundaries. The accepted automatic-rest calculation, Firestore reads, motion and #488/Jev are separate work.

My Page still calls `location.assign('/admin/users')`, although ApplicationRouteRoot already supports same-document history changes and lazy Admin entry. Replace this document navigation without changing the Admin authorization or auth-session boundaries.

## Decision and safety boundary

1. Reuse the existing history event and existing `chat.dirty` authority: selected, because it retains the original leave-warning criterion without changing AI execution or persistence.
2. Keep document navigation whenever work is dirty: rejected as the final approach because it preserves avoidable reloads and two entry mechanisms.
3. Introduce a generic navigation blocker registry or new busy-turn restriction: rejected as unnecessary scope. Pending AI turns and pending approvals are not independent warning criteria in the current beforeunload contract.

The My Page entry must preserve the profile draft if confirmation is cancelled, reject callbacks from closed/replaced owners, and clear the old editor lifetime only after accepted navigation. Existing beforeunload handling remains unchanged. Admin's independent permission check remains authoritative. Browser Back/Forward, repeated clicks, signed-out/denied paths and late profile-save completions need regressions.

## Implemented boundary

- The App supplies a synchronous leave confirmation using the existing `weeklyPlanning.chat.dirty` getter. No new interpretation of pending turns, approval or composer text is introduced; the existing document-level beforeunload listener is unchanged.
- My Page uses `pushState` plus `APP_HISTORY_CHANGE`, which the existing ApplicationRouteRoot already observes. Only an accepted, still-current owner/dialog can navigate and close. Cancellation leaves the edited profile open.
- Closed, unmounted, replaced-owner and revoked entry callbacks cannot navigate. The current entry is checked again after confirmation. Accepted navigation retires the profile editor lifetime so repeated clicks and late profile-save completion cannot affect a later editor.
- Root switching, independent Admin authorization, lazy Admin code/styles, normal/public startup authentication and browser history behavior remain unchanged. Existing popstate transitions were already outside the leave guard; this task does not introduce a global history blocker.

## Verification checkpoint (2026-10-16)

Verification ran on HEAD `9abc46038e7fb6d8dd0c26dabf31b8e251311473` plus the exact code/test changes in `src/App.tsx`, `src/App.aiNavigation.test.tsx`, `src/components/MyPageDialog.tsx`, `src/components/MyPageDialog.adminEntry.test.tsx`, `src/components/MyPageDialog.avatarSelection.test.tsx` and `src/components/MyPageDialog.saveFeedback.test.tsx`. Documentation was finalized afterward without changing those verified inputs.

- Red baseline: the new My Page entry suite on the original production code failed 9 of 10 tests. It reproduced document navigation, ignored confirmation, and retained stale entry callbacks. The existing late-save lifetime test already passed.
- Green: focused 15 files / 171 tests passed (exit 0), covering the new ten My Page entry cases, actual App + chat persistence failure/recovery, profile/photo/save regressions, normal/public roots, real Admin authorization, weekly application recovery and admin routes.
- The App test injects an actual chat-checkpoint write failure, verifies both beforeunload and the new entry confirmation use the same dirty condition, declines/accepts confirmation, and verifies successful checkpoint retry clears both warnings. It does not fabricate a new busy-state criterion.
- Fresh `npm run typecheck:app:full` passed (exit 0). `git diff --check` passed. No package or config changes.
- Execution: Node 24.19.0; installed React / renderer 18.3.1, Vitest 3.2.7, TypeScript 5.9.3, Vite 6.4.3. `DEV_LAN_HOST=127.0.0.1`; one Vitest worker, no file parallelism. Repository lock SHA-256: `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`; installed package-lock SHA-256: `6964e32dd8cfa9e3912b31f4b53858df2c99d7f2cd45f15bc0c069190de37940`; installed package-manifest inventory SHA-256: `4da51b6014962314cfb557ebbd7910874c07e234351179c6eeb0c142d829a90e` (235 package manifests).
- Local evidence directory: `/workspace/shared/laplans-next-work-20261017/admin-entry/`. `baseline.log`, `focused.log`, `typecheck-app.log`, `verification-inputs.json` and `installed-package-manifest.json` record commands/results and exact changed-input hashes; the final receipt records the committed HEAD/tree. The root integration owner retains this evidence independently of repository publication.

## Expected impact and remaining gates

The component/root integration test proves zero `location.assign` calls and a single same-document history update per accepted entry. This removes the deliberate document reload, including reloading/executing the initial application document. Admin's own lazy loading and auth/access readiness are still required; normal planner state is not kept mounted while in Admin. No real-device latency number is claimed.

Next: independent review and clean local commit receipt to the integration owner; run combined full verification/production build before publication. Browser acceptance should use 390 px and 1280 px viewports, count document navigations through My Page → Admin → return → Back/Forward, and inspect cancelled/accepted unsaved-chat confirmation, access revocation and signed-out return. Native browser, real Firebase account and physical-device results are unverified here. No production data/API was used. No branch was deleted; retain the local branch until the integration owner accepts or abandons the candidate.

## Recovery and browser acceptance checkpoint (2026-10-17)

The previous execution filesystem was unavailable after resumption. The eight-file candidate was restored onto freshly fetched main `9abc46038e7fb6d8dd0c26dabf31b8e251311473` using retained exact tool-output contents, then compared to the recorded six code/test SHA-256 values and whole repository tree. All six hashes matched; restored commit `e9708484effa1a34056d60fee9bd04b101af2ab0` has the exact original tree `e0b68d14f620fa1cdd1754c350d2eaa7f123b87b`. Old transient logs were not recovered, so they are not presented as newly available evidence. A fresh canonical-lock install and fresh focused run passed 15 files / 171 tests in the new environment.

The follow-on acceptance tests use the existing general browser harness. The production App, planner/chat hooks, My Page, root history listener and Admin access guard remain real; startup onboarding is outside this authenticated-entry test, and only external auth/role delivery, observability data and the existing harness repository/runtime boundaries are synthetic. An actual storage-write fault drives the chat's production dirty state. The four cases cover:

1. Normal → Admin → return → Back/Forward with a single document request and no sign-out.
2. Real checkpoint failure, declined confirmation preserving profile/composer drafts, then accepted confirmation entering Admin.
3. Live access revocation and sign-out, with no protected content and an available return action.
4. Browser Back while the lazy Admin module is pending, followed by a delayed module failure that must not replace the restored Home surface.

The spec is selected by the ordinary Chromium suite and all four cross-browser projects, including mobile WebKit (16 cases collected). Existing `admin-style-loading.spec.mjs` remains the production lazy-CSS delivery/cascade coverage; it is not duplicated by the new harness. Shared harness aliases default to denied Admin access outside the dedicated entry page.

Verification of the new test inputs: Playwright collection passed; Vite transformed all five entry/root/access/Admin modules; an isolated production-mode build of the new entry harness passed. This harness build is not the production application build or a browser pass. Local execution using the installed system Chromium failed before page launch with `process_singleton_posix.cc:297`, `socket() failed: Operation not permitted (1)`. Six attempted viewport cases were launch failures, not failed product assertions; no restriction-bypass flags or alternate browser route were attempted. The final four-case spec still requires exact-candidate native CI. Evidence, the restoration receipt and local launch logs are in `/workspace/shared/laplans-admin-acceptance-20261017/`.

Known existing limitation: ApplicationRouteRoot has Suspense but no error UI for a lazy Admin import that fails while Admin remains active. The new late-failure-after-Back case does not claim to solve that condition. No ErrorBoundary behavior was added without a reproduced consequence and separate scope decision. Publication and exact-head native CI belong to the sole integration writer; real Firebase/physical-device acceptance remains separate.
