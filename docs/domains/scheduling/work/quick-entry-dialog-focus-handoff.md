# Quick-entry dialog keyboard focus

Status: original local implementation checkpoint; not published. Combined verification is owned by [Home add expansion](home-add-expansion-motion-handoff.md).
Owner: existing [Issue #483](https://github.com/kame447/StudyPlanner/issues/483)
Branch: `fix/quick-entry-dialog-focus`
Base / initial HEAD: `84b69b9b6a0810071e530509c5230fcc4a81d6bf`
Base tree: `032bf1e5f4924e6e3cf58a447b1f35d0ad8e4749`
PR: none

## Scope and evidence

QuickEntryModal declares a modal dialog but does not own initial focus, Tab
containment or focus restoration. The Home inline menu deliberately focuses its
retained launch button before opening this form. No enclosing HomeAddFlow focus
boundary takes over. Consequently keyboard interaction remains in the background
until the user manually reaches or clicks the form. The merged #601 checkpoint
explicitly left real destination-form focus restoration unverified.

Three alternatives were inspected before implementation:

1. A caller already owns the dialog focus. HomeAddFlow contains only the portal
   and the existing form, and QuickEntryModal has no focus hook or keyboard
   listener. No caller-level boundary was found for this path.
2. Input-focus policy intentionally forbids any initial focus. The current
   input-focus regression explicitly permits the shared useDialogFocus hook;
   focusing a non-input dialog preserves the prohibition on automatic keyboard
   opening and viewport zoom locks.
3. The form has a missing connection to the established shared focus boundary.
   Connect that hook to the existing form without changing shared policy,
   persistence, validation, styling or the existing close-during-save contract.

Current open PRs and both pages of remote branches were checked on 2026-10-13.
No active quick-entry focus owner was found. The existing material quick-entry
date branch and closed input-focus change concern different contracts. Do not
modify MonthEventDialog, its nested date picker, or the shared focus hook here.

## Acceptance and next action

- Reproduce missing initial focus, containment and restoration on the base using
  the real component and shared hook with a controlled DOM fixture.
- Verify non-input focus, Tab/Shift-Tab boundaries, repeated opening, Escape,
  unmount, hidden/disconnected return targets, and existing save/lifetime tests.
- Add desktop/mobile browser regressions for the actual Home study-entry path.
- Run focused tests, fresh typechecks, full unit/integration tests and build on
  the final content. No threshold or existing assertion may be weakened.
- Native browser execution is unavailable in this environment and must remain
  unverified until an authorized usable browser/CI path is available.
- Upstream publication, main changes and merging are not authorized for this
  new fix. Hand the exact local diff and evidence to the release owner first.

## Local checkpoint — 2026-10-13 13:55 UTC

- The production change is four additive lines connecting the existing
  useDialogFocus hook to the form and making that non-input target focusable.
  Shared hook policy, close/save callbacks and styling are unchanged.
- On the base, the initial seven regressions produced four behavioral failures
  (entry focus, Tab containment, Escape and restoration) and three passes.
- The candidate passes six focused files / 29 tests, including eight focus
  cases and the existing save/owner/lifetime tests. The added interrupted-save
  case verifies Escape, visible-launcher restoration, reopening and rejection
  of the previous entry's late save completion.
- Fresh app and Worker typechecks passed before the final added focus test.
  The first aggregate verify was interrupted by an executor transport
  disconnection during the unit suite. It produced no terminal result or build
  evidence and is not a passing aggregate run.
- The browser file parses and Playwright discovers both 390px/1280px cases.
  No browser was launched, so these are not native-browser results.
- Node 24.19.0 / npm 11.9.0; 235 installed locked packages match the lockfile
  and are unchanged. The checkout uses a private top-level node_modules link
  farm so Vite caches do not mutate shared installed packages. The supported
  DEV_LAN_HOST override avoids network-interface discovery in this restricted
  environment. Worker type generation uses bundled sample cf metadata through
  CLOUDFLARE_CF_FETCH_ENABLED=false; no production API is called.

The concurrent `fix/home-add-expansion-motion` task changes Home's action menu
to remain expanded after selection. This branch deliberately does not implement
that behavior. Its current-base browser assertions expect return to the retained
plus button; combined verification must instead expect the retained selected
action when that separate change is integrated. The shared hook already returns
to whichever connected, visible element actually launched the form.

## Integration handoff — 2026-10-13 14:06 UTC

The subsequent serial `npm run verify` passed fresh app/Worker typechecks but
ended with 13 failed / 7,875 passed / 54 skipped / 1 todo across 858 files. All
13 failures were `HTMLElement is not defined` in two existing renderer-based
integration fixtures that provide window/document but had no DOM element class
or animation-frame API. This is a harness boundary failure, not a passing full
run; the chained production build did not execute.

The two fixtures now supply HTMLElement, a null activeElement and the missing
frame/event APIs. Their real component, repository and persistence assertions
are unchanged. The shared focus hook is not mocked or modified. Final focused
verification passes **8 files / 42 tests**, including all 13 previously failing
cases and the eight new focus regressions. `git diff --check` passes and the
235 installed locked package identities remain unchanged.

The release owner grouped this change with `fix/home-add-expansion-motion` as
one Home interaction release. Do not publish a separate focus PR. Preserve this
original local branch/commit, integrate it into the motion candidate, adapt the
two Home browser cases to retained-action focus (including the second open/close
cycle), and run the final fresh full verification, production build and native
browser acceptance on that combined content. This avoids a redundant standalone
full run while keeping the final integration gate mandatory. The standalone
change is **not full-verified or browser-verified**.

No remote branch, issue comment or PR was created; no branch was deleted.
