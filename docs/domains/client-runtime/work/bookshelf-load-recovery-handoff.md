# Bookshelf module delivery recovery

Status: active, local implementation and independent source review complete; publication pending
Owner: runtime lane; related Issue #542
Branch: `fix/bookshelf-load-recovery`
Base: `e6ce01091319bd47b6cf66ef35fc4f444924d69a`

## Scope and current checkpoint

Inspect the actual Home → Materials entry for whole-root loss when the optional Bookshelf module rejects. Settings is eagerly imported; Contact already owns a local exception boundary and synchronous return navigation. Pending Admin/Announcements candidates are separate and unchanged.

2026-10-17 08:32 UTC ownership: current main verified through explicit GitHub URL; triage checked 34 open PRs / 199 remote heads. PR #706 owns Bookshelf motion internals, not App's deferred entry or failure recovery. Keep those internals and material semantics untouched.

## Competing hypotheses and decision

1. Contact-style ancestor recovery already protects Bookshelf. Falsified if the real root becomes null and drops history listeners after an import rejection. Inspecting App, LaplanceAppRoot and ApplicationRouteRoot finds only Suspense around Bookshelf.
2. Preload failure handling protects foreground entry. The preloader catches warm-up failures, but foreground React.lazy has its own rejection state. Reproduce the actual click with background warm-up disabled, without changing production data or API access.
3. A genuine missing local boundary causes whole-root loss. If confirmed, prefer the existing DeferredMonthView pattern: a Bookshelf-only wrapper retains the global navigation. A global boundary would enlarge failure ownership; automatic reload or remount retry could discard state or falsely retry React's cached rejection.

## Confirmed defect and local repair

On the unmodified base, a real ApplicationRouteRoot → LaplanceAppRoot → App render reaches Home; clicking the actual primary Materials navigation starts the rejected optional import. React removes the whole tree, the root's history listeners are cleaned up, and a later popstate cannot recover Home. The one-case baseline demonstration passed. Its first configured run used the wrong expected top-level Vitest error message; asserting the injected error through the wrapper's cause fixed the harness without changing runtime code. The desired two-case regression then failed on the original runtime.

The new DeferredBookshelfView follows the existing Month shell: local exception boundary, unchanged Splash fallback and complete prop forwarding. App swaps only its deferred import. Outer navigation, app state, auth and history remain mounted. Home can be reached and the cached failed import can be reentered without killing the app. No fake retry, automatic reload or mutation is introduced. The boundary resets on owner replacement or view unmount; a cached import rejection remains a rejection until the document is genuinely refreshed. Like Month's boundary, this also contains descendant render errors in the Bookshelf surface.

BookshelfView, its material semantics and all motion implementation remain unchanged. Settings and Contact needed no same-root-cause repair in this audit. Other unprotected lazy surfaces are outside this focused change and are not claimed fixed.

## Verified local checkpoint

- `DeferredBookshelfView.loadFailure.test.tsx`: actual-root return/reentry, retained navigation/history/auth, account replacement and signed-out form.
- `DeferredBookshelfView.pendingFailure.test.tsx`: pending leave, late rejection, current-owner cached failure and no material writes.
- `DeferredBookshelfView.lazyLoading.test.tsx`: the real Bookshelf module stays deferred; cancelled-owner entry is not replayed, current-owner add action is retained and consumed once, later return stays closed.
- Focused run: 13 files / 52 tests passed, including real material handoff, AI navigation retention, preloading and existing Month/Contact/public/root boundaries.
- Fresh `npm run typecheck:app:full`: exit 0.
- Browser spec syntax and `git diff --check`: passed.
- Two production-module failure browser cases appended to existing bookshelf-surface spec. Collection passed for Chromium desktop and WebKit mobile (4 definitions total). Existing configuration and successful bookshelf cases are unchanged.

Initial runner startup failed before tests because LAN address autodetection is unavailable. The repository's existing DEV_LAN_HOST=127.0.0.1 configuration avoids that optional detection. All actual proof used command-local TZ=UTC, CLOUDFLARE_CF_FETCH_ENABLED=false, WRANGLER_SEND_METRICS=false, DO_NOT_TRACK=1, VITEST_MAX_FORKS=2 and VITEST_MIN_FORKS=2. No permission or source configuration was changed.

Native browser execution is still unavailable under the existing launch denial and was not retried. The four collected browser definitions are not an execution pass. No whole-suite verify, production build, CI or publication was performed in this lane; the user's related-tests-only direction and integration ownership remain explicit.

Independent review completed on implementation commit `61449db8cee6753c16e346f8c549c58d29e8468e`, tree `a6db1664a3e0cf4c01c14443153048bb7960a309`: no blocking source finding; all eight reviewed file hashes and verification logs matched. This review-status update changes documentation only. Native delivery/layout, build and CI remain unverified.

Next: retain this local candidate for the integration owner's publication decision and applicable related verification. No global framework or unrelated lazy surfaces.

## Exit criteria

- Demonstrate baseline failure under the actual application root.
- Keep Home navigation, auth/history owners and persisted data intact on rejection and repeated entry.
- Preserve pending dismissal, account replacement and successful material handoff.
- Run only related tests and applicable type feedback for this worker; independent review and exact-input receipt.
- Native browser launch remains denied; do not retry or work around it. Browser definitions and integration/release gates are separate from locally verified behavior.
- No GitHub/main writes.
