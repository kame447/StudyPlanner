# Complete the startup video before revealing the application

Status: active
Updated: 2026-10-08

- Owner: Issue #483, branch `fix/laplans-video-completion`, base `f281c6c0ba56ef7b57865b7edcfd276d11a7b2ab`.
- This is a new playback contract after merged PR #545. The old immediate-readiness release was intentional in that release and is now superseded by the user's explicit request.
- Healthy video completes by default. Current application readiness and a terminal video outcome must both be satisfied before revealing children. Readiness alone must not unmount a playing clip.
- Skip is presented/enabled only when the current application surface is safe to reveal. Before readiness, gestures cannot finish playback or release authentication/data gates.
- Ended-before-ready leaves the final still/loading surface. Reduced motion, failed playback and bounded no-progress fallback must not trap startup. Backgrounding pauses and later resumes; it is not completion by itself.
- Root-managed and standalone App use the same composition boundary; root-owned inner App never owns a second movie. Readiness callbacks retain their session identity and old-session invalidation.
- Actual visibility, not mere data readiness, starts notice dismissal and optional preload.
- Verification unit: both ordering directions, before/after-ready tap/keyboard, auth/consent/error/owner changes, background/resume, all fallback outcomes, notices/preload, standalone and one-video ownership. The user subsequently requested that E2E remain untouched. No E2E spec, fixture, configuration or workflow is changed. Existing movie assertions for immediate-readiness dismissal, pre-ready skip and hidden completion conflict with this new contract; report those failures explicitly rather than altering runtime to satisfy obsolete expectations.
- Follow the authorized focused-local → draft PR → GitHub full/browser final gates workflow. Do not weaken timeouts or assertions, and do not call local collection a browser pass.
- PR publication, successful-CI main merge and automatic production update are authorized for this new change only. No production data or AI experiments.

## Local verification checkpoint

- Changed non-document input digest (SHA-256): `98d2ceb2012325c9c424c5fc8d977a7b3476d38cc884572821b98bf491b873ef`.
- Focused final run: 12 files / 165 tests passed, 13.07 seconds; real root/bootstrap/auth hooks plus media, standalone App, Home display-clock and material handoff regressions.
- Fresh application and Worker type checks passed. Production build passed in 12.72 seconds. All eight existing bundle guards passed without adjustment: JS 2,245,660 raw / 604,198 gzip; CSS 484,924 raw / 81,483 gzip.
- Independent review found and verified a same-batch authentication/skip race. The parent now synchronously authorizes and records media completion against the current session before the video accepts it. Both event orders and sign-out/same-owner return pass.
- Media completion reasons are explicit: ended, skipped, reduced-motion, autoplay-blocked, media-error and stalled. Backgrounding is pause/resume, not a completion reason. No-progress fallback retains the existing four-second interval; healthy playback progress resets it.
- MP4, poster, final still, dependencies, CSS, E2E, workflow, budget, auth/data implementation and production settings are unchanged. MP4 SHA-256 remains `b379904df0f8e34659a63bedd86e09d81711b31e8e325d91eb58c1d502750083`.
- Browser playback of this new contract is not yet verified. Existing `laplans-startup-video.spec.mjs` has six conflicting old-contract cases: two pending-read touch-skip cases (lines 55–81), three pending-auth keyboard cases (84–92), and readiness-alone removal (159–169). Chromium and WebKit both select them. Other five-second Home expectations may also conflict with a still-playing nine-second clip. This is an explicit unresolved release gate; do not treat predicted or actual failures as success.
- Next: publish the draft with exact local/remote tree equality, observe untouched GitHub checks, and resolve the user's E2E constraint with the release owner before merge. Main/production update requires the approved verification criteria, not merely a published draft.
