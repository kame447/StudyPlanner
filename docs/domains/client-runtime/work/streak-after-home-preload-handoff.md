# Study streak detail preload after Home

Status: local implementation and focused checks complete; integration/release pending
Owner: UI umbrella Issue #483
Branch: `fix/streak-prefetch-after-home-20261015`
Base: local `80cc93670d69da87491155d17c5ec8fdfe0f1be9`, tree `92bbb6259f120596ea8094a196392796ca5e8ba9` (approved #689/#693 combined snapshot)

## Scope and evidence

The user requested early loading of the study streak after the initial reload. The existing Home provider already starts its shared history reader only after startup content is visible and the owner's planner snapshot is ready. The Firebase reader reuses confirmed startup history and reads the rest-day document. Opening the detail uses this same provider, not a second data reader.

The missing piece is the lazy detail module: `StudyStreakPage` was absent from the optional view preload list. It remained click-loaded while other major screens were warmed after Home.

Considered: starting a second data prefetch (unnecessary reads/races); moving the provider earlier (competes with startup and violates the request); adding the detail module to the existing post-Home idle preload (preserves data/readiness owners and directly covers the missing code). The third option is selected. Existing scheduler cancellation, one-shot module promise and fallback timing remain unchanged.

Preflight inspected root AGENTS, open/closed streak PRs (#647/#653/#656), #483 and its latest returned comments, open streak PR search (none), and streak branches (only earlier feature/integration branches). No active same-scope work was found. The startup-canvas worker owns index.html and does not overlap. No Issue/PR or remote branch is created; this local branch represents the new requested follow-up.

## Verification and next action

On 2026-10-15 18:07 UTC, `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/lib/preloadAppViews.test.ts src/App.plannerDataRecovery.test.tsx src/components/StudyStreakPage.test.tsx src/hooks/useStudyStreak.test.tsx src/repositories/confirmedStudyHistory.test.ts src/repositories/firebaseStudyStreakRepository.test.ts src/repositories/firebaseRepositories.lazyStudyStreak.test.ts` exited 0: 7 files, 57 tests. Coverage includes code import/cache, idle and fallback scheduling/cancellation, actual App initial-readiness boundary, provider reuse across detail open/close, and confirmed Firebase history reuse. `npm run typecheck:app` exited 0. `git diff --check` passed.

The first test invocation could not load Vite configuration because sandbox network-interface enumeration failed; the existing `DEV_LAN_HOST` override avoided that unrelated discovery path. The first running test draft exposed retained Vitest mock factories after module reset; per-case `doMock` registration fixed that harness issue without changing production behavior or weakening assertions.

Verified runtime SHA-256: `src/lib/preloadAppViews.ts` = `386d941392a6bc05929ae3c42c5a5ed75a0902d904c37c3df816d055c9bdcacb`; test SHA-256 = `97ad38e20305506d40d496c0fea1536bd8cb5064e69a4f5336894c8927fa8027`. Base HEAD is above; dirty verification inputs were these two files and this documentation only. Node v24.19.0, Vitest 3.2.7, TypeScript 5.9.3; installed packages were reused from the existing durable-ai-turns installation without installation or dependency changes. This is focused feedback, not full-tree or installed-dependency identity proof for release reuse.

The production diff is one optional-module import. No new query, subscription, history scan, cache or persistence rule is introduced. Existing provider/data boundaries are unchanged. Browser network timing, authenticated production, full combined verify, Worker types and production build were not run by this worker.

Exit: minimal diff with focused evidence handed to the integration owner. Full combined verify/build, native browser acceptance and publication are integration-owner work. Do not publish or merge without the parent's approval.

## Authorized integration checkpoint — 2026-10-16

The owner approved publication and verified-in-order main integration. The existing implementation branch `fix/streak-prefetch-after-home-20261015` is reused. This cumulative candidate preserves the earlier accepted batch changes and current main `729d212c`; only this unit's original patch and documentation indexing are added. Final exact-content verify, applicable CI/browser results, main integration and public asset verification are owned by the single release coordinator. Existing capacity-budget failures remain separately deferred without threshold changes. Physical-device behavior and production performance remain unverified.

The existing preload sequence waits for all primary imports before secondary QuickEntry/OCR imports. Adding the streak detail to primary can postpone secondary warming if that import is slow. The idle scheduling timeout does not bound import duration. No foreground import or owner/readiness gate is changed; real network ordering and user-visible latency are not measured.
