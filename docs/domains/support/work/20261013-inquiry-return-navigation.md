# Inquiry return navigation

Status: locally implemented and verified; remote browser gates and publication approval pending
Branch: `fix/inquiry-return-navigation`
Base: `840e7aeb6dd962fdc51de43cc3ab54818b82b427`
Existing feature: merged [PR #612](https://github.com/kame447/StudyPlanner/pull/612). No existing open repair PR/branch found during 2026-10-13 preflight. This is a distinct post-release navigation repair. No new Issue or remote PR is created.

## Cause and scope

The support link and contact return link use plain document navigation. Both root and App also branch on pathname, so merely intercepting anchors would replace authentication/bootstrap and/or the active planner subtree. Preserve the started planner lifetime while displaying public pages; retain native Back/Forward and direct public URL access. Authentication changes must continue to revoke stale owners even while hidden. Inquiry draft/receipt still belongs only to its mounted form and is not automatically submitted or persisted.

Compared approaches: anchor interception alone leaves stale pathname and remount boundaries; embedding contact only within settings loses direct URL/public access; a small public-page boundary above startup can own same-document URL changes and retain the live planner without a general router. Choose the last approach, with guarded native anchors and an independent scroll surface. Existing planner body portals must remain hidden without affecting unrelated notifications.

## Verification / next action

Next: implement boundary and regression tests, then exact-content fresh `npm run verify` and diff review. Include settings history, root mount/subscription identity, direct public entry, auth owner changes while hidden, inquiry draft disposal and native-link modifiers. Add desktop/mobile browser regressions; local native browsers are unavailable due to confirmed socket restrictions and will not be retried. Browser execution remains an explicit unverified release gate until authorized remote CI can run.

No AI/Jev, Firestore Rules, shared Docker/CI infrastructure, production submissions, upstream pushes, merges or deployment in this repair.

## Repair / verification checkpoint

The boundary now owns public URL routing above root startup and standalone App, retaining the existing planner subtree. Public pages use an independent fixed scroll surface so an active study session can retain its body scroll lock and timer. Existing planner-owned portal selectors are hidden for public pages, without targeting unrelated notifications. The settings history owner removes only its own marker on explicit return; other history state remains intact. Direct public entry temporarily uses the existing theme hook, with no second theme owner after planner startup.

The first full check found one test-harness defect: an old App fixture retained only the last window listener, unlike real addEventListener, so the newly added root subscriber hid the settings subscriber from its synthetic Back event. The fixture now dispatches to every registered listener per event type; its original assertions remain, with added actual-App contact round-trip identity checks. The initial full result was 7,827 passed / 1 failed / 54 skipped / 1 todo; build did not run after that failure and that run is not final proof. A separate direct-public theme regression was reproduced in all three paths before adding the temporary owner.

Browser regressions cover 1280/390px document identity, native history, retained body portals, running timer elapsed time of at least 60 additional seconds, independent public scroll under its body lock, and direct contact/reload/theme restoration. The same spec is registered in the existing cross-browser selection; no Docker or workflow changes. These tests are collected locally but not browser-executed in this environment.

## Final local verification

Frozen implementation verification: `npm run verify` exit 0 on 2026-10-13 11:46 UTC. Fresh application/Worker typechecks, 845 test files / 7,831 tests passed, production build succeeded. The 11 skipped files / 54 skipped tests / 1 todo are not passes. Focused navigation/root/theme/settings/contact/actual-App checks passed 76/76. The old support anchor mutation fails the new round-trip test; direct-public theme tests failed 3/3 before the temporary theme owner and pass afterward.

Evidence in the sibling `inquiry-return-navigation-evidence-20261013/`: `verify.log` SHA-256 `fa1cb3be678a8baefea5b3496b008559a2d2403928506e1fc0fc52bb45a5e734`; `identity-comparison.json` confirms every source/config input, 19,305 installed dependency files, generated Worker types, tools and relevant environment matched before/after the final run. Node v24.19.0, npm 11.9.0; installed-files manifest SHA-256 `3b9fceeeda854dc9c1e7c383f2c7b894071f6a67f4b26284027612adbfe057b2`. Only the domain README/checkpoint prose was adjusted afterward.

Independent source review found no remaining demonstrated implementation blocker. Browser collection passes for Chromium (5 cases) and the existing 4-project cross-browser matrix (20 cases). Native execution is unavailable in this environment; these are definitions/collection, not proof of native focus, scrolling, portal or timer behavior. The inherited bundle-budget violations remain and thresholds are unchanged.

Next: obtain publication approval for this separate post-release fix, then use the existing CI/browser gates on the authorized exact remote tree. Do not call the production symptom resolved before those gates and any authorized deployment verification. Keep this one branch for subsequent review fixes; no new remote Issue/PR or replacement branch was created, and no branch was deleted. Main remained `840e7aeb6dd962fdc51de43cc3ab54818b82b427` at the final pre-commit check.


## Visibility follow-up after cumulative review

The original `d6320450d0a00f10ba8ecee53f53eea9a3b3eedd` remains archived unchanged. Independent review of the composed profile-recovery flow exposed another navigation-owned boundary: asynchronous startup can finish behind a public page before Home has ever been visible. Its first layout must not measure zero-size hidden geometry. Already-mounted Home also must not overwrite layout measurements while public content is open.

App now delays only an owner's first layout descendants until public content closes; bootstrap/readiness and auth subscriptions continue. An already-presented planner stays mounted during ordinary public-page round trips. A standalone owner change clears that presentation history, including separate A → null → A updates. The root retains its existing auth-epoch responsibility for batched auth events. Home's real measurement effect pauses while public content is open, ignores zero-sized hidden geometry, invalidates stale animation/font-ready callbacks, and measures again on return without requiring a resize.

Regression evidence: the initial hidden mount failed before the fix; both real Home measurement-effect probes failed before the fix; an additional standalone same-owner session probe failed before presentation-history invalidation. All four are green after the correction, and the final five-file focused suite passes 65 tests. Native desktop/mobile cases use the existing controlled-startup harness to finish startup behind contact, then require first visible Home geometry and retained node identity on subsequent Back/Forward. Native execution is still unverified.

Final cumulative `npm run verify` passed on 2026-10-13 12:12 UTC: 849 files / 7,909 tests, fresh app/Worker typechecks and production build. The 54 skipped tests / 1 todo remain excluded from passes. This exact snapshot combines navigation with profile recovery #619 (including the production-logo fixture), corrected theme storage #620 and Admin #618; it does not assert that the original standalone tree was reverified unchanged. The evidence is in `inquiry-cumulative-evidence-20261013/`: `verify.log` SHA-256 `c04262d68d0a7f1eeb46a04658bd4ed0366cf3ad3d197499dac663b45b55bedb`; every code/config input, generated Worker types, 19,305 installed dependency files, tools and relevant environment matched before/after. Only documentation was edited afterward.

The cumulative browser selection collects 52 cases: inquiry 28, theme 16 and profile recovery 8. Browser collection is not browser execution. The four inherited bundle-budget violations remain; no threshold, Docker or workflow was changed. Publication of this inquiry repair still requires separate authorization, followed by native browser gates on the exact publishable tree.


## PR #621 native fixture correction

Publication was authorized on 2026-10-13; [PR #621](https://github.com/kame447/StudyPlanner/pull/621) reuses `fix/inquiry-return-navigation`. Its first remote head `32556a67c941c73a1a8500a14339dfed1b2d0ae4` has parent main `84b69b9b6a0810071e530509c5230fcc4a81d6bf` and exactly the reviewed `d5628cd4` tree. Exact-head core CI passed 7,909 tests, fresh types, Rules, audit and build; visual, browser-quality and Admin checks also passed.

The first Chromium, Firefox and desktop WebKit matrix runs each exposed three incorrect test preconditions: the round-trip and direct-entry cases seeded an empty planner but expected the populated Home schedule panel. Raw logs and a native 390px screenshot show the correct getting-started screen, not an application exception. The two running-timer and two hidden-startup cases passed on each of those browsers. The correction seeds one real plan on the fixed test date for the populated-Home cases and asserts its title; the timer cases deliberately retain their empty-Home seed. No production source or existing assertion was weakened.

After this spec-only correction, fresh local `npm run verify` passed on 2026-10-13 14:00 UTC: 849 files / 7,909 tests, application/Worker types and build. Before/after source, generated inputs, installed dependencies, tools and environment hashes all match. `verify.log` SHA-256: `24020a91914de424295782e0cb558803bb026309e132d21f85dbdd08036c665b`. The 28 inquiry browser cases collect successfully. This documentation was the only post-verification change. Native rerun must reach the later history/focus/portal assertions; collection and the earlier timer successes do not establish that result.

## Audited public navigation focus statements

On head `7911dffac1d91956fd6fc0e519df8936c7eb38fa`, the four-browser matrix passed all 28 inquiry cases on their first attempt (matrix totals: Chromium 79, Firefox 79, desktop WebKit 83, mobile WebKit 231; skipped cases excluded). Independent review confirmed the actual native history/focus/portal/timer assertions and exact tested tree. Successful inquiry screenshots/traces were not retained by the existing artifact settings; those results are native assertions, not screenshot inspection. The complete Browser Regression run passed 634 cases and failed only its static production-source focus audit.

The audit identified the two new focus statements as unregistered. They respectively focus the non-input public return link and restore the user's prior focus only when that origin is connected and visible. Following the existing settings/Pomodoro policy, register only those two exact statements with their ownership reasons, not the component path. Production code and automatic-input-focus restrictions remain unchanged. Executing the actual source-audit body without launching a browser reproduced the same red and then passed; a virtual extra `inputRef.current.focus()` in that same component still fails the audit, proving the exception is statement-specific.

Fresh `npm run verify` after this seven-line test-only correction passed on 2026-10-13 14:34 UTC: 849 files / 7,909 tests, app/Worker types and build. Every recorded source/config/generated/dependency/tool/environment input matched before/after. Log SHA-256: `e154fecf0a9961f1b4ff9f567ffef0c01a260c1f721a98ffc61023b8a1fb6258`. Only this checkpoint was edited afterward. Publish the corrected exact tree on the same PR and require terminal native/full CI results before merge; the previous failing broad run is not treated as a full pass.
