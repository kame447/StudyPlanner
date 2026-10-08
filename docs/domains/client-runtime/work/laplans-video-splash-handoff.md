# Laplans startup video

Status: active
Updated: 2026-10-08

Current state: the frozen local candidate passed the regular final `npm run verify` and all eight bundle limits. Real browser playback/layout/gesture checks remain blocked by this environment. The user approved a PR and its automatic preview on 2026-10-08 at 11:47 UTC; publication is the next step and is not yet verified here. Nothing from this work is on main or in production.

## Ownership and source

- Branch: `feat/laplans-video-splash` (local only)
- Base / initial HEAD: `22847120386987329e2f034d6062d59694ef1180`
- Related UI umbrella: Issue #483. No new Issue or implementation PR was created.
- Separate work: #542 remains in its own worktree/diff. Its Root props changes are not part of this video candidate; `StudyPlannerAppRoot.tsx` is unchanged from this branch's base.
- Read preflight: current AGENTS, worktree/branch state, open PRs, related closed startup PRs, branch searches, and latest #483 comments. No existing active owner of the video presentation scope was found.
- User-supplied video: `src/assets/laplans_blackhole_1080x1920.mp4`, from asset PR #543 (`assets/laplans-blackhole-video`, exact commit `ae409f0f55602db57449162ac2a1ad1b93d32422`). Only this one binary was extracted; the PR's other 123 changed files were not integrated. Its branch/history was not merged or cherry-picked.
- Source blob: `c4fb93460dbc6015b06d897ab371ab409cdbf6c0`; SHA-256: `b379904df0f8e34659a63bedd86e09d81711b31e8e325d91eb58c1d502750083`.
- Actual video: 512×910, 9.000 seconds / 270 frames / 30fps, H.264 High level 3.1, yuv420p, no audio, 1,628,755 bytes. The filename's 1080×1920 is not the actual resolution. `moov` is at byte 28 before `mdat`, so no fast-start rewrite is needed. Full ffmpeg decode completed without error.
- Representative frames and the final image were inspected: stars converge into a vortex, then the Laplans logo. The original encoding is unchanged. `laplans-startup-poster.jpg` is the actual 0.5-second star frame; `laplans-startup-still.jpg` is the actual final branded frame. No replacement artwork was generated. The first frame itself is black, so it was not used as the loading poster.

Preparation and verification were confined to this isolated checkout. PR publication and its automatic preview were subsequently approved; main changes, production deployment, data and billing changes remain outside scope. The publication owner must record the actual remote commit/PR/preview result before describing them as published.

## Presentation boundary

The animation is decorative. It never releases authentication, current privacy consent, profile/preferences, memory, or planner-data readiness gates. The existing root and standalone App keep their current authority over when the splash disappears. The movie's 9-second duration is never added to readiness.

Candidate approaches considered:

1. Make startup wait for video completion. Rejected: delays a ready application, particularly on fast launches or slow media connections.
2. Have skip release the root startup surface. Rejected: could expose incomplete or unauthorized application content.
3. Keep video/static fallback transitions inside the splash presentation. Selected: skip, completion, playback failure, reduced motion, or backgrounding retain ordinary loading; readiness removes it immediately.

Implementation:

- `StartupVideo` requests muted inline autoplay; the whole presentation is a native skip button, with an accessible name, keyboard activation and focused Escape handling.
- No reduced-motion or initially hidden video is mounted. Later preference/background changes stop the intro without replaying on return.
- A stalled initial or buffering interval falls back after four seconds. Healthy playback has no artificial duration cap or loop.
- Skip/end/error/rejected autoplay use the actual final Laplans frame and matching dark canvas, never the old white branded screen. Status text remains available to assistive technology.
- Cleanup pauses, removes `src`, calls `load()` to abort remaining media work, removes listeners and cancels timers. A StrictMode setup on the same element restores a removed source, and superseded play rejections are ignored. Actual wire-level cancellation/cache behavior remains unmeasured.
- Root-owned inner App loading can coexist behind `display: none`. The existing RootStartupReady context suppresses an inner video, so only the outer startup presentation requests media. No root readiness production code changed.
- The `.splash-screen` node, main label and timing-observer boundary remain intact. Internal lazy-route surfaces remain static and themed. Legacy fixed-light canvas remains white; the intro and its final-frame loading fallback use a scoped dark canvas. `object-fit: contain` preserves the complete portrait composition on narrow and wide screens.

## Preview media serving

The normal `npm run preview` server previously returned MP4 as application/octet-stream with no byte ranges. A dedicated media responder now supplies video/mp4, byte lengths, GET single ranges, HEAD without a body and unsatisfiable 416 responses. Malformed/multiple ranges are ignored with a normal full 200 response. Streams are destroyed on disconnect/error. Existing path/security checks, other asset responses and immutable-asset cache policy are unchanged. CI's Vite preview is a different existing serving path.

An independent reviewer exercised the actual video: prefix/middle/suffix 206 responses matched exact bytes; full 200 matched the original SHA-256 and 1,628,755 bytes; HEAD and range-416 returned no body. This proves the HTTP contract, not Safari playback.

## Verification checkpoint

The focused evidence below is supplemented by the exact-content full verification receipt in the next section. No second worker should independently rerun the full suite for the same frozen content.

- Focused: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- scripts/preview-media-response.test.mjs src/components/StartupVideo.test.tsx src/components/SplashScreen.test.tsx src/components/StudyPlannerAppRoot.test.tsx src/components/StudyPlannerAppRoot.parallelStartup.test.tsx src/components/StartupTimingPanel.test.tsx --maxWorkers=1 --minWorkers=1`: 106 passed, exit 0.
- Tests cover media lifecycle, actual asset URL wiring/fallback, hidden inner suppression, auth/consent/memory/planner gate preservation and immediate removal when ready, plus GET/HEAD/range/empty-file/cleanup HTTP boundaries.
- `npm run typecheck:app`: successful during implementation; fresh non-incremental app/Worker checks also passed in final verification below.
- Production build and bundle budget: exit 0 after CSS deduplication. An initial build exceeded total CSS by 596 bytes; common canvas variables, shorter dedicated selectors and removal of redundant declarations resolved it. Budget thresholds were not changed.
- New browser regression spec is syntax-checked. It covers real touch, Enter/Space/focused Escape, real playback/end events, 390/1280 geometry/canvas, ready-unload, reduced-motion no-request and rejected autoplay. Collection/execution remains separate evidence.
- Independent review found no production blocking issue in the latest runtime/CSS/media responder. Natural-end E2E records the actual ended event with approximately 9-second time/duration, so a stall fallback cannot masquerade as completion.
- Source media decode and representative-frame inspection succeeded. These are not browser layout or Safari decoder evidence.
- Chromium launches in this environment previously failed with socket EPERM at both normal and escalated permission levels. Do not repeat them or count mocked events as actual browser testing. No real iOS, browser layout/gesture, authenticated startup-speed or network cache measurements were performed.
- Runtime dependencies are unchanged: React / React Test Renderer 18.3.1, TypeScript 5.9.3, Vite 6.4.3, Vitest 3.2.7. Existing shared node_modules reused; no install or lockfile edits. Actual installed dependencies were captured and matched before/after final verification.

## Final local verification receipt

- Run: 2026-10-08 11:43:13–11:53:29 UTC, once, on `feat/laplans-video-splash` at HEAD `22847120386987329e2f034d6062d59694ef1180` plus this candidate's 14 non-documentation changed/new files. A later commit may reuse this proof only if the verified runtime/test/media/configuration inputs remain identical.
- `npm run verify`: exit 0. Fresh non-incremental app/Worker checks and Worker type generation passed; Vitest reported **762 files / 6,200 tests passed**, with 10 files / 45 tests skipped and 1 todo. Those skipped/todo cases are not passes. Vitest took 555.04 seconds; production build took 10.64 seconds.
- `node scripts/ci/check-bundle-budget.mjs`: exit 0, all eight limits passed, no violations. JavaScript raw/gzip totals: 2,243,661 / 603,532 bytes; largest raw/gzip: 762,739 / 215,434 bytes. CSS raw/gzip totals: 484,924 / 81,483 bytes; largest raw/gzip: 424,396 / 68,818 bytes. The total CSS limit remains 485,000 bytes, leaving only **76 bytes of headroom**. Future CSS changes need the budget gate; the threshold was not raised.
- Before/after non-documentation input count: 1,843; no changed input. Aggregate SHA-256: `3e84df7f218c617183de5a16dac4f28f1150a5a219a511adf9ef812480f85a75`. Documentation, build/cache artifacts and generated Worker types are excluded from this source digest and assessed separately.
- Installed packages: 237 present, identical package.json/version/hash entries before/after; 99 optional packages absent. No required package is missing and no installed version mismatches the lockfile. Installed-manifest SHA-256: `c2e89d328f764cab8d792110f5318037b59b31166f914af5fc03fb4c716449b7`.
- `package-lock.json` SHA-256: `0cc1f34fa1ead88aab107a9cd1f91e00575d514d45406a5ec452d98b71bfdbb5`; `package.json`: `7877203514d489bdede79cc5bfad696adc7a05ce9e141e3ebf4a360079cf5deb`; installed `.package-lock.json`: `d7dc78db8dcc49679fd16d62f570c662e3c9514b282aea5116bbb07021e689b4`. All three matched before/after.
- Worker runtime types were absent before the run and generated normally by the required command: 615,867 bytes, SHA-256 `bf808b3fb4789a76410fc9c1ba8cd85e80453b8f92fa0981bdb86a9d523d612e`, workerd 1.20260926.1 / compatibility date 2026-04-10. This expected generated-input transition is recorded, not described as an unchanged before/after file.
- Environment: Node 24.19.0 / npm 11.9.0, isolated HOME and allowlisted environment, UTC, no source `.env` or inherited credentials, existing dependencies, offline npm configuration, Vitest thread/fork min=max=1. The receipt-only post-run `python` lookup failed in the isolated PATH; the existing interpreter immediately captured the after snapshot and every comparison matched. Verification/build/budget were not repeated.
- Durable evidence: [comparison](laplans-video-splash-evidence/comparison.json), [before snapshot](laplans-video-splash-evidence/before.json), [after snapshot](laplans-video-splash-evidence/after.json), [verification log](laplans-video-splash-evidence/verify.log), [execution environment](laplans-video-splash-evidence/execution-environment.json), [bundle report](laplans-video-splash-evidence/bundle-budget.json), [generated Worker identity](laplans-video-splash-evidence/worker-generated-identity.json), and [copy/log provenance](laplans-video-splash-evidence/evidence-provenance.json). The saved verification log removes ANSI formatting, one trailing space on Vite reporter line 5120 and surplus final newlines only; no log lines were removed, and original/saved SHA-256 values are retained.

This full run does not include Playwright execution, native browser/iOS playback, screenshots/gesture checks, a Firestore emulator run, authenticated startup-speed measurements or live-network/cache tests. The separately reviewed socket-free MP4 response probe proves bytes/HTTP-response construction, not end-to-end browser delivery. No remote CI or preview result is implied by local success.

## Next action and exit criteria

1. Preserve the verified runtime/test/media snapshot and review the exact staged diff before the local commit. Record the resulting commit in the publication handoff; a docs-only edit or commit creation does not require another full run.
2. Publish the approved PR/automatic preview and verify the actual remote commit, required CI and preview outcome. Keep #542 and PR #543's other source changes separate.
3. Real browser desktop/mobile playback, layout and gesture verification remains a release gate in a permitted environment. Do not equate the React tests, ffmpeg decode or the presence of a browser spec with execution of that gate.
4. Any later code, media, test, configuration, dependency or generated-input change requires reconciliation and the relevant fresh verification. Main/production/data/billing changes need separate authorization.

The feature is a locally verified implementation candidate with an explicit browser-validation gap. It is not yet a verified published, production-deployed or fully browser-verified result.
