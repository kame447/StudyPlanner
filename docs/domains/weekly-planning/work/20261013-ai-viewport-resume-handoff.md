# AI viewport after returning from another app

Status: local candidate verified with focused tests; cumulative integration and native browser verification pending. No remote publication or merge authorization.

- Owner: viewport-return repair, separate from server-side AI-turn recovery/architecture.
- Related issue: #483. Historical PRs #537 and #611 are merged; their retained branch names are not active ownership.
- Branch: `fix/ai-viewport-resume`; no PR. Base/initial HEAD: `98f3c324b5320d38294905c858ce1d2310209312`.
- Preflight (2026-10-13 20:16 UTC): current main, open issues/PRs, remote branches, #483 latest comments and #537/#611 fetched. No competing viewport-resume owner/checkpoint found. No previous viewport-resume worktree or changes survived the interrupted investigation.
- User evidence: reported screenshot shows the AI shell/navigation ending well above the bottom, after returning from another app. The screenshot alone does not identify browser geometry or the physical-device cause.

## Competing explanations and scope

1. Missed resize on return: the hook writes a pixel height and listens only for visual-viewport resize/scroll and window resize. A dismissed keyboard while away can therefore leave the earlier height if no geometry event reaches the hook. Test by changing metrics without resize then dispatching visibility/pageshow. Low-risk remedy: remeasure on the actual page lifecycle.
2. Event delivered before geometry refresh: an immediate read can still see old dimensions. Test separately by updating metrics between the lifecycle event and the next animation frame. A single frame-aligned read is bounded; it is not a timeout/polling workaround. Historical WebKit report 254861 comment 4 supports this possibility, not diagnosis of this user's device.
3. Browser-reported geometry itself remains wrong, or CSS/static layout is wrong: a reread cannot repair incorrect browser dimensions. Existing CSS consumes the pixel override before 100dvh. Inspect current sizing and keep physical-device validation explicitly pending; do not invent screen-size substitution, force zoom, blur, body scroll or keyboard heuristics.

## Acceptance and next action

The three new regressions failed on the unchanged hook (430px retained instead of 844px): visibility return without resize, pageshow without resize, and stale event-time geometry. The candidate rereads actual VisualViewport metrics once in requestAnimationFrame on visible/pageshow. Repeated signals coalesce; hidden/inactive/unmounted surfaces cancel pending work and release listeners. Existing direct resize/scroll behavior, actual keyboard geometry, pinch handling, reader position, CSS fallback and prior-property restoration are preserved. No CSS or sizing heuristic was added.

2026-10-13 20:21 UTC focused verification:

- Hook tests: 23 passed, including the 3 previously failing regressions, reader end/older-message preservation, genuine keyboard and pinch return, coalescing without polling, hidden cancellation, inactive/unmount cleanup and reactivation.
- Broader AI presentation boundaries: 97 passed across hook, image ownership, module recovery, persistence and App navigation (5 files). Command: `DEV_LAN_HOST=127.0.0.1 node node_modules/vitest/vitest.mjs run src/hooks/useAiPlanningViewport.test.tsx src/components/AiPlanningView.imageOwnership.test.tsx src/components/AiPlanningView.moduleRecovery.test.tsx src/components/AiPlanningView.persistence.test.tsx src/App.aiNavigation.test.tsx --config vite.config.mjs --configLoader native --maxWorkers=2 --minWorkers=1`; exit 0.
- Fresh `npm run typecheck:app:full`: exit 0. No lint script is configured. `git diff --check` and E2E JavaScript syntax pass.
- Added four native-layout cases for visibility/pageshow × latest/older messages, with repeated returns, missing resize, stale event-time dimensions, full shell/nav extent, retained draft/focus/reader, and inactive geometry ownership. They use simulated lifecycle/metrics and do not reproduce a physical app switch. Chromium and WebKit-mobile each collect 14 tests (4 new). Collection is not browser execution.
- Node v24.19.0 / npm 11.9.0 / Vitest 3.2.7. Existing shared installation is reused; no dependencies or runner configuration changed. Lock SHA-256: `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`.

Next: preserve the candidate commit for the integration owner, then apply it after the color and compact-form candidates to the coordinated cumulative snapshot. Do not run a redundant standalone full suite/build: the integration owner has explicitly queued cumulative final verification. Independent diff review and native browser execution remain pending. Local browser execution is already known blocked (Chromium socket EPERM), so it was not retried under unchanged conditions.

The WebKit reports [254861](https://bugs.webkit.org/show_bug.cgi?id=254861) and [218983](https://bugs.webkit.org/show_bug.cgi?id=218983) describe historical device-specific stale or incorrect geometry; neither establishes this user's device/version/cause. If the browser itself continues reporting the wrong height after a frame, this bounded lifecycle reread cannot repair it. Device reproduction remains necessary before claiming the screenshot's specific failure is fixed.

Runtime semantic/network/provider/approval/persistence behavior is out of scope. User-device recovery is not verified by synthetic tests. Completion requires exact-diff review, relevant test/type/build evidence and authorized browser/publication validation; upstream/main writes are not authorized by this local repair.
