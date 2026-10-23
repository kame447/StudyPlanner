# Authenticated profile restoration recovery — Issue #542

Status: Draft [PR #619](https://github.com/kame447/StudyPlanner/pull/619); a test-fixture asset correction and current-main integration are being verified. Root coordinates the eventual merge.

## Publication checkpoint — 2026-10-13

- First published HEAD `bbb6dacb2a9091d5abdc98ff68533669ff403da3` on main `840e7ae` matched verified tree `9a60afbc9ae51964b29779bc0a8c1f6843b1e4b7`. Its local combined focused 380 cases and full 7,837 cases passed with all 2,441 source inputs and 19,329 installed entries unchanged.
- Exact-tree CI passed fresh types, all 7,837 tests, real demo Firestore Rules and build. Chromium passed 624 cases; mobile WebKit passed 220, including all eight recovery cases in each browser without retries. Desktop Matrix, visual, Admin and browser-quality checks passed. The four existing bundle failures match local metrics and remain separately accepted, with unchanged thresholds.
- The sixteen recovery executions verified saved light/dark/ocean preferences, deferred profile/planner busy state, single-flight/repeat rejection, external sign-out and simulated intro ordering. The paused intro clock allowed normal pointer/actionability settlement; this remains a simulated gate test, not native video/performance evidence.
- Screenshot review found the unchanged test Vite root did not serve the shared logo's `/icons/laplans-192.png`. Production public/build bytes match. The recovery spec now serves those exact production bytes at that one local fixture URL and requires positive image `naturalWidth` before screenshots. No shared Vite configuration or runtime markup changed. Old screenshots with a broken placeholder are not final visual acceptance.
- This correction is combined with merged main `3c19e5560f161249fbc9208669ec08f60b11b9c8` (Admin overview snapshot). Its seven paths are retained unchanged. Final focused/full verification and the next exact-head browser/screenshots are pending; no separate interim head is published.
- Current ownership is also recorded in [Issue #542](https://github.com/kame447/StudyPlanner/issues/542#issuecomment-6144566509). The original local-stage records below remain historical evidence. Do not close #542 or infer installed-PWA performance/pending-operation recovery from this work.

## Original local-stage scope and ownership

- Existing owner: https://github.com/kame447/StudyPlanner/issues/542
- Local branch: `fix/profile-restore-recovery`; implementation base `cf725d088ab1249fe1da6fe7d40e6b9274fa61e4`.
- Preflight and pre-commit readback on 2026-10-13 found no other active terminal-profile recovery implementation. The latest #542 checkpoint remains comment 6139094817. The branch is retained for review; no new Issue or PR and no remote write were made.
- #611 owns separate App/UI integration and #612 owns inquiries. `App.tsx`, AI/#488/Jev, repository persistence, dependencies and CI/infrastructure are unchanged.

## Change

A real rejected profile restoration for the current authenticated root retains a dedicated recovery surface instead of falling through to registration after an expiring notice. One explicit retry calls the existing profile-to-planner bootstrap. It reads the profile afresh and leaves required repair/create to the existing repository; it never replays an old write payload.

A synchronous admission guard requires an existing terminal failure, no active bootstrap, a mounted hook, an unrevoked startup scope and a matching live identity. Old handlers/results are inert across owner replacement and unmount. The recovery surface remains mounted while retry is pending, including planner loading. Successful profile restoration followed by failed planner loading goes to existing planner recovery.

Consent, preferences, memory and intro keep their gates. Unsettled read/create/repair operations have no new timeout or retry. Null/unverified results and real sign-out keep their prior behavior. Optional bootstrap ports keep their standalone behavior; authenticated recovery requires the current root capability. Generic notice timing is unchanged. No write cancellation, rollback, cross-client idempotency, pending-memory recovery or installed-PWA speed improvement is claimed.

## Exact-content verification

- Three real-repository read/repair/create failure cases failed against the unchanged base because no recovery surface existed, then passed after implementation.
- New recovery suite: 28 cases. Real root/recovery/auth/planner boundaries and actual Firebase repository use deferred local SDK doubles. The real App/AuthScreen case distinguishes rejected restoration from sign-out; other cases use a lightweight application-state probe.
- Focused final run: 284 passed / 23 files, exit 0. Covers same-owner retry, duplicate clicks, repeat rejection, fresh required writes, 60-second pending operations, owner/unmount fencing, memory/intro gates, profile-save lifetime, normal authentication, optional bootstrap ports, diagnostic privacy and generic toast lifetime.
- Final `npm run verify`: exit 0; fresh non-incremental app and Worker typechecks, 7,782 passed / 837 files, production build 5.19 seconds. Fifty-four skips and one todo are excluded from passes. The run was serialized and real network was blocked; zero transport attempts were recorded.
- 2,423 tracked/untracked inputs and 362 installed-package manifests matched before/after. All 19,329 installed file/symlink identities also match the pre-copy dependency owner's full manifest, including executable bytes, modes and link targets. A private dependency copy prevents cache writes through shared dependencies.
- First-time Worker runtime type generation was blocked by local workerd socket restrictions. Wrangler's supported runtime cache was reused only after checking identical generator/workerd bytes, workerd `1.20261001.1`, compatibility date `2026-04-10` and no flags. Generated type SHA-256 `c96c8ed5d4ba9748b9b191362998ccf92a7a7ae97a7f8c4a7bce008b1fedef79` is unchanged; Wrangler explicitly logged cache reuse. This is not fresh workerd generation.
- The checkpoint update itself is documentation-only after the verified runtime/test snapshot. The integration receipt records the final local commit/tree and exact patch.

## Cold saved-theme follow-up

Independent review found that profile failure before memory release could make recovery the first mounted application surface. The ordinary App's theme hook had never run, so saved dark mode/palette were not applied. The recovery screen now uses the existing theme hook. Two actual-hook regressions fail on the original local commit and pass with the correction; the prior theme mock was removed. No theme context, CSS or preference contract was added.

Eight native browser cases extend the existing startup-gates harness through an opt-in test-only deferred/rejected restore and held memory boundary. They cover saved light/dark ocean at 320/390/1280 pixels, ordinary pointer retry through profile/planner waits, repeat failure, one synthetic same-task admission burst, external sign-out and one simulated intro-readiness case. Tests set only stored preferences; they do not force DOM theme. The actual Firebase write tests remain in Vitest.

Source syntax/JSX transformation passed. All eight cases collect in the normal Chromium config, existing harness-only recovery runner and mobile-WebKit Matrix config. Browser execution remains unavailable. The intro clock/media controls test simulated gate ordering only, not native video playback or performance; its actionability/request-animation-frame settlement must be checked when browser execution is available. The original local commit `6ea615b6b8ccca86e3d8c7f72102b9ce954cbbd8` and its evidence are preserved; this is an additive correction.

## Original local-stage release boundaries

Local Chromium launch failed before any page execution because sockets are prohibited in this environment. Browser/visual/mobile and installed-PWA verification are not claimed. No further local browser attempts were made after the restriction was established.

The separate bundle gate fails the same four limits on both exact-base and candidate builds: total JavaScript raw/gzip and CSS total/largest raw. The candidate adds 2,029 raw JavaScript bytes and 1,157 aggregate gzip bytes. All CSS outputs are byte-identical to base. Limits were not changed; the candidate is not all-gates-green.

Before publication, the integration owner must review the exact local commit, decide the bounded publication scope and reconcile any new main changes. Applicable CI/browser/visual and capacity gates remain required. No merge or deploy is authorized by this local implementation. Keep #542 open for the unresolved-pending policy and real installed-PWA cause; this terminal-rejection fix does not complete that broader work.
