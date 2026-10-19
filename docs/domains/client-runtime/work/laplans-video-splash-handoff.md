# Laplans startup video

Status: active
Updated: 2026-10-08

Current state: [draft PR #545](https://github.com/kame447/StudyPlanner/pull/545) and its automatic preview are published. The first head passed CI, visual/quality/admin checks and eight of nine video browser cases. The reduced-motion transfer observer misclassified a Vite JavaScript asset module; the follow-up candidate corrects that observation, adds an actual-binary detection control and includes all ten cases in WebKit mobile. The corrected observer/WebKit-selection head passed final local verification and is running in CI. One final browser-only addition reproduces the known Pages Range-ignored delivery; its published browser result exposed an engine-specific request-header assumption, corrected locally without changing playback assertions; final updated-head CI is pending. Nothing from this work is on main or in production.

## Ownership and source

- Branch: `feat/laplans-video-splash`; [draft PR #545](https://github.com/kame447/StudyPlanner/pull/545)
- Base / initial HEAD: `22847120386987329e2f034d6062d59694ef1180`
- Related UI umbrella: Issue #483; no new Issue. The existing local implementation branch was published as PR #545 after confirming no matching implementation PR existed. Asset PR #543 contains a different, divergent change and was not reused for implementation.
- Separate work: #542 remains in its own worktree/diff. Its Root props changes are not part of this video candidate; `StudyPlannerAppRoot.tsx` is unchanged from this branch's base.
- Read preflight: current AGENTS, worktree/branch state, open PRs, related closed startup PRs, branch searches, and latest #483 comments. No existing active owner of the video presentation scope was found.
- User-supplied video: `src/assets/laplans_blackhole_1080x1920.mp4`, from asset PR #543 (`assets/laplans-blackhole-video`, exact commit `ae409f0f55602db57449162ac2a1ad1b93d32422`). Only this one binary was extracted; the PR's other 123 changed files were not integrated. Its branch/history was not merged or cherry-picked.
- Source blob: `c4fb93460dbc6015b06d897ab371ab409cdbf6c0`; SHA-256: `b379904df0f8e34659a63bedd86e09d81711b31e8e325d91eb58c1d502750083`.
- Actual video: 512×910, 9.000 seconds / 270 frames / 30fps, H.264 High level 3.1, yuv420p, no audio, 1,628,755 bytes. The filename's 1080×1920 is not the actual resolution. `moov` is at byte 28 before `mdat`, so no fast-start rewrite is needed. Full ffmpeg decode completed without error.
- Representative frames and the final image were inspected: stars converge into a vortex, then the Laplans logo. The original encoding is unchanged. `laplans-startup-poster.jpg` is the actual 0.5-second star frame; `laplans-startup-still.jpg` is the actual final branded frame. No replacement artwork was generated. The first frame itself is black, so it was not used as the loading poster.

Preparation and verification were confined to this isolated checkout. PR publication and its automatic preview were subsequently approved; main changes, production deployment, data and billing changes remain outside scope. The first published head and preview evidence are recorded below; later local changes are not treated as published before remote verification.

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

## First publication and browser correction

- First remote head: `1816590bc444bb6a44a14f3462471dc22b423c54`, tree `1639913e54a03c2c9077a3381fc74c27836cc063`. Native local commit `5d2c171bde799ed09c159ed0feb3114753144a6c` and CI synthetic merge `942fea730a3016a64a18bd81b91390f709e6f8e5` have that exact tree. The API commit has a different identity, not different file content.
- [CI](https://github.com/kame447/StudyPlanner/actions/runs/37775765853): fresh app/Worker checks, 6,200 passed / 45 skipped / 1 todo, Firestore authority regression and build 6.51 seconds succeeded. [Matrix](https://github.com/kame447/StudyPlanner/actions/runs/37775765781): 322 cross-browser passed / 3 intentional skips; visual 4 passed. [Quality](https://github.com/kame447/StudyPlanner/actions/runs/37775766037): browser 5 passed and bundle success, with the existing conditional Lighthouse/stability skips. [Admin](https://github.com/kame447/StudyPlanner/actions/runs/37775766010): 45 passed.
- [Chromium](https://github.com/kame447/StudyPlanner/actions/runs/37775765684): 442 passed / 1 failed / no flaky cases. Eight video scenarios succeeded on their first attempt, including actual 9-second completion, touch/keyboard skip and readiness-triggered cleanup. The 390px/1280px final-frame screenshots were inspected: complete Laplans composition and loading text, dark canvas, no clipping in the captured state. [Original browser artifact](https://github.com/kame447/StudyPlanner/actions/runs/37775765684/artifacts/11550287512).
- The reduced-motion no-transfer assertion failed on the initial attempt and retry. Both traces contain exactly one observed `.mp4?import` request: resource type `script`, response `Content-Type: text/javascript`, 638-byte body. This is Vite's asset URL module, not the 1,628,755-byte MP4. The correction classifies non-script MP4 requests and independently captures `video/mp4` responses; it does not simply suppress a URL suffix. Both no-transfer empty assertions and the existing UI/gate assertions remain. Normal playback uses the same observer as a positive control, and a new deliberate binary-fetch case proves that an actual MP4 transfer is detected even under reduced motion.
- The original cross-browser matrix did not select the video spec. The follow-up adds it only to `webkit-mobile`, retaining the existing ten scenario assertions and runner limits. It does not route `hasTouch: true` into Firefox or change shared fixtures. Collection establishes ten Chromium plus ten WebKit-mobile cases; collection is not execution.
- [First preview](https://b10a1a12.studyplannner.pages.dev) deployed successfully for the exact first head. Its served MP4 and both JPEGs matched source bytes/SHA-256. Two Range probes (deployment URL / HTTP2 and branch alias / HTTP1.1 with identity encoding) returned `200` and the whole file, not `206`. This matches [documented Pages behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/#behavior). The Node preview responder is separate and does not change Pages. No CDN settings or infrastructure were modified.
- WebKit's local-harness result, once available, will not establish actual iOS behavior or deployed Pages playback. Those remain distinct release checks; the original file's fast-start layout and successful full download are not substitutes.

## Follow-up final local verification

The corrected media observer, explicit real-download control and WebKit-mobile selection passed a new exact-content `npm run verify` on 2026-10-08: exit 0, fresh app/Worker checks, 762 files / 6,200 tests passed, 45 skipped / 1 todo, production build 15.43 seconds. All eight unchanged bundle limits passed. The 1,843 non-documentation inputs and 237 installed packages were unchanged during the run; final source digest is `91ff664de56b6247a31feadaf6bd6020954a1a0a91b70ad6faf5dd642944f00b`. The [follow-up receipt](laplans-video-splash-evidence/followup-verification.json) records the two manifest overrides, installed/tool identity and raw-log hashes. Original runtime/media input hashes are unchanged.

Ten video cases collect in each of Chromium and WebKit-mobile. Browser execution and the updated PR/preview checks still require their own final result; the reduced-motion expectation was not weakened and real iOS/Pages Safari playback remains a distinct boundary.

## Corrected-observer publication checkpoint

The corrected observer and WebKit-mobile selection were published at head `fceaaee4ba0c2a9649fcf01d48838ed6ca00cb7f`, tree `c81ae52d23eddce6c8d168b1f5fb7082812714ec`; local `e17b7b85d9c11f84e16845dfe4e9799461939ebf` and CI merge `e82dbe23f97ab33ba432b1fde40880a9ef5818a0` have the same tree. Its [CI](https://github.com/kame447/StudyPlanner/actions/runs/37781802728), [Quality](https://github.com/kame447/StudyPlanner/actions/runs/37781802680), [Admin](https://github.com/kame447/StudyPlanner/actions/runs/37781802687), visual job and [Pages preview](https://b5a29646.studyplannner.pages.dev) succeeded.

[Chromium](https://github.com/kame447/StudyPlanner/actions/runs/37781803223) passed all 444 cases. All ten video cases also passed on their first attempt in [WebKit mobile](https://github.com/kame447/StudyPlanner/actions/runs/37781802780), including the corrected no-transfer observation and deliberate real-download control. Both 390px/1280px WebKit final-frame images were inspected. This proves the local Vite/browser fixture behavior, not real iOS or deployed Pages playback.

The overall matrix is **failed**, not green: 331 passed / 3 intentional skips / 1 flaky. The existing `home-pixel-student.spec.mjs` America/New_York 1280px hidden-start case observed `entering` instead of `studying`, then passed its retry. That separate Home visibility/clock diagnostic is read-only and no Home source or test is changed in this candidate. The final new-head matrix must still be checked; a retry pass is not accepted as overall success.

## Pages delivery-condition regression

The final browser-only addition retains the ordinary Vite completion case and adds one case that responds to MP4 media requests with status 200 and the complete original binary, Content-Length and a strong ETag, without Content-Range. The Vite JavaScript asset module is left unchanged. The case requires native currentTime progress, a real ended event at approximately nine seconds and the unchanged pending-data gate. A separate explicit Range fetch verifies the ignored-range 200/full-body response; the native decoder is not required to choose Range transport. A small JSON attachment records each substituted delivery.

This is a reproduction of the observed HTTP boundary, not a connection to Pages or proof of real iOS behavior. Syntax and collection succeed for eleven Chromium and eleven WebKit-mobile cases; execution is still pending. No runtime, asset, timeout, retry or assertion threshold changed. This is the final added verification scope for the known iPhone delivery risk.

## Final Range-delivery local verification

The final Range-ignored case candidate passed `npm run verify` and the unchanged bundle gate: exit 0, fresh app/Worker checks, 762 files / 6,200 tests passed, 45 skipped / 1 todo, build 10.95 seconds. All 1,843 source-input records and 237 installed package identities matched before/after. Final non-documentation digest: `fab2a7fd7ecee113c4f8585a00135a775d0bd44d4521d103b2d1af6578bb7c0e`. [Exact receipt](laplans-video-splash-evidence/range200-verification.json).

The first full attempt had one existing provider-exhaustion integration timeout (6,199 passed / 1 failed) and did not build. Its source/dependency hashes were stable. The unchanged file passed all six cases in isolation, and the exact failed case passed separately. After inspecting the fixture and Vitest timing boundaries, one fresh-process full retry passed with the original timeout. A root cause was not conclusively established; the failure, focused checks and reporter-duration distinction remain recorded. No failing test was excluded or weakened.

Final Chromium/WebKit delivery execution and the full new-head matrix remain separate gates. The previous head's Home visibility flake remains diagnosed separately; it is not silently accepted as a green matrix.

## Native transport observation correction

Head `c9cc91b1f808fdf75d23108d84b8f86218e8f553` passed CI (6,200 tests, fresh types, Rules/build), Chromium 445 cases, quality/admin/visual and Pages. Matrix was failed with 332 passed / 3 skipped / 1 failed / no flaky cases. Its ten ordinary video cases passed on the first attempt and the previous Home flake did not recur.

The added full-body case's WebKit first attempt and retry both received the exact original 1,628,755-byte MP4 via HTTP 200 and fired real `ended` with time=9 and duration=9. The network trace recorded `Sec-Fetch-Dest: video`, resource type `other` and no Range header. The failure was the test's assumption that every native decoder sends Range, after the successful ended assertions and before its final static-loading assertion. This was not a playback failure. [Matrix evidence](https://github.com/kame447/StudyPlanner/actions/runs/37788656384/artifacts/11555784151).

The same case now separates contracts: preserve native full-body transfer, real playback/completion and pending-gate checks; explicitly fetch with `Range: bytes=0-63` and require status 200, video/mp4, no Content-Range and the full original byte length; require that the fixture actually observed that explicit Range. Native Range presence is recorded without imposing a platform-specific behavior. The attachment includes deliveries, ended data and the explicit probe response. No runtime, timeout, retry or pass threshold changed.

Syntax, both eleven-case collections and independent diff/logic review cover the local correction. Under the updated verification procedure, the same draft PR is updated after focused checks and GitHub full/browser CI is the final gate; the full local suite is not repeated for this browser-only correction. The earlier successful local full run is historical evidence, not an assertion that this final browser edit has executed.

## Next action and exit criteria

1. Preserve the verified runtime/test/media snapshot and review the exact staged diff before the local commit. Record the resulting commit in the publication handoff; a docs-only edit or commit creation does not require another full run.
2. Update the same approved PR/automatic preview and verify the actual remote commit, CI and preview outcome. Keep #542 and PR #543's other source changes separate.
3. Real browser desktop/mobile playback, layout and gesture verification remains a release gate in a permitted environment. Do not equate the React tests, ffmpeg decode or the presence of a browser spec with execution of that gate.
4. Any later code, media, test, configuration, dependency or generated-input change requires reconciliation and the relevant fresh verification. Main/production/data/billing changes need separate authorization.

The feature is published as a draft with an explicit follow-up verification gap. It is not production-deployed or fully browser-verified; first-head successes are not a substitute for final updated-head acceptance.
