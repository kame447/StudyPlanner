# Mobile WebKit functional budget and retry recording

Status: integrating the owner-approved three-case functional budget into existing PR #836. Rendering latency is not fixed; #805 remains open. Native verification of the combined recording-policy/budget head is pending.

Branch: `fix/mobile-retry-recording`. Integration base: main `72f5192222da2608c5de46557f548f655905ba04`; previous PR head: `88cebf49ff04be9c3b86b002782d17c25fd144e6`.
Scope: retain the first-retry recording policy and original production paint. Only WebKit mobile's 1920×1080 save/reload at 100%, cancel at 200%, and save/reload at 200% receive a 60-second functional deadline. Other test deadlines, screenshots, actions, assertions, viewport/DPR, retry count, workers and fail-on-flaky are unchanged.

PR #833 is now merged and its Node runtime guard and scoped Miniflare transport mitigation are inherited from main. This PR adds no separate Node or dependency change. The documented embedded Wrangler transport limitation remains; this is not full toolchain clearance.

## Approved functional-budget correction (2026-10-23)

The unchanged three functional journeys completed on their first attempts under a diagnostic 60-second limit in [run 39865467903](https://github.com/kame447/StudyPlanner/actions/runs/39865467903). Callback-only monotonic timings were 36.396s, 33.796s and 35.951s; those exclude fixture setup and teardown. This establishes that the functional checks can complete while exceeding the old 30-second whole-test limit, not a performance fix or a product latency guarantee.

The owner approved changing only these three functional deadlines to 60 seconds, separately from speed improvement. `tests/fixtures/bookshelfLongText.test.ts` invokes the real callback up to browser preparation across 144 project/viewport/scale/purpose combinations and checks that exactly these three change. The source-contract test retains recording, retry, worker and global-default safeguards while allowing this one approved test-local setter.

The direct, uninstrumented three-case [run 39908830839](https://github.com/kame447/StudyPlanner/actions/runs/39908830839) also passed all three on their first attempts with a reported 60-second timeout. That run retained normal capture; it is not evidence for this integrated PR's first-retry recording configuration or for all Matrix cases.

Next: verify this combined content, then run the applicable native checks on its exact published head. Keep #805's rendering-cost investigation and #776's motion decision separate; do not infer either is resolved by the functional budget.

The sections below preserve earlier experiments and their then-current limits. Historical 30-second/capture-only and unmerged-#833 statements are not the current integration contract.

## Root-paint continuation

Recording alone did not fix Issues #805/#776. The same-host capture ABAB run
`39759365546` timed out on all 12 first attempts, including capture-off arms.
The separate original-grid versus grid-none run `39828610723` showed a large
paint-cost difference, but its single fixed-order pair does not establish a
long-term flake rate. Grid removal was diagnostic, not an accepted visual change.
The subsequent finite/strip tile candidate failed exact fractional-geometry
RGBA comparison in run `39833530306` and is not adopted.

The root-removal candidate `b72e21149323588fa8a9ddf47f083e7c0b57e702`
failed Matrix `39852846190`. Chromium's classic scrollbar reserves a 15 CSS-pixel
gutter. At DPR 1.5 the body edge falls on a fractional device pixel, exposing
the changed root paint. All 128 pixel cases failed coverage admission on both
attempts; 48 identities also had actual RGBA differences on both attempts,
while every original-repeat comparison was zero. The first audited sample
differs only at device column 562 (body right 375 CSS px × 1.5), with 1,155
changed pixels and maximum channel difference 4/255. This bound applies to
that sample, not every identity or platform. Actual Windows classic-scrollbar
and macOS overlay-scrollbar behavior remains unmeasured.

A complete independent PNG audit of all 96 differing attempts (48 identities,
retries 0/1) in artifact `12459682931` confirms one changed device-pixel column
per image: 562 at 390px or 2857 at 1920px, exactly the fractional body boundary.
Changed-pixel counts range from 203 to 1,266; maximum per-channel difference is
10/255, not the first sample's 4/255. Changed-row bounds can extend to 1608;
1,266 is the maximum count of changed rows, not their largest coordinate.
These are bounds for the retained settled Linux Chromium DPR-1.5 corpus only;
transitions and other platforms remain outside that proof.

Firefox and WebKit desktop each passed all 128 settled pixel comparisons.
WebKit mobile shard 2 passed all 31 bookshelf cases on their first attempts,
including the three known #805 identities, once each. The earlier ordered
original/grid-none contrast and these narrow-margin successes support further
paint investigation, not a stable flake rate or a visually safe speed fix.
Mobile shard 1 was cancelled at the unchanged 35-minute job limit, after 370
passing stdout entries and three skips, with 77 of 128 pixel cases complete.
Its missing final JSON is missing evidence. Month and Day 1280px each printed
one first-attempt pass before cancellation; neither is a proven repair.

The settled comparisons also exclude the real 200 ms body-background fade:
an earlier Firefox observation had body alpha 250/255 during that transition.
Removing root paint has no all-transition equivalence proof. The inverse
candidate, retaining the root while making the body transparent, was rejected
statically: fixed-body preview scroll locking uses `top: -lockedWindowScrollY`,
so common-origin grid-phase equivalence is unproved. No inverse native run or
experimentally observed inverse pixel failure is claimed.

The original root and body backgrounds are therefore restored. The temporary
128-case pixel spec, its cross-browser inclusion and the added root-ownership
unit test are removed because their production change is rejected. All original
regression assertions remain. The extra pixel cases caused the 424/189 shard
allocation; restoring the original collection removes that added capacity cost
without changing workers, deadlines, retries, screenshots or the job limit.

The rejected root-removal head's Core verify passed, but UI Quality failed the
unchanged budget at CSS +3 raw/+5 gzip bytes and JS total/largest gzip +7/+7.
These were candidate violations, not baseline exceptions. Final restored-head
build, budget and native acceptance remain required; no threshold is changed.

The month overnight observation admits standard appearance. The pixel-only
correction therefore cannot directly explain a month-case improvement; #776
remains a separate investigation even if an individual month run passes.

## Recording boundary and tradeoffs

The Matrix execution step enables the policy only for `webkit-mobile`, and only the bookshelf-surface spec consumes it. Local runs, other projects, other spec files, planner-recovery and the separate zero-retry stability job keep existing capture. First failures retain screenshots, error context and JSON, but trace/video are recorded only on the first retry; a passing retry still fails the existing flaky gate. Explicit screenshots remain unchanged. Manual targeted Matrix dispatches use the same scoped policy.

An isolated video-off/trace-off diagnostic passed the three previously failing 1920px cases in 26.983, 25.020 and 28.087 seconds. This motivates the bounded recording-policy change, not a claim of proven application speed or long-term reliability; the remaining margin is narrow and worker reuse confounds part of the comparison.

Implementation feedback: four focused source-contract tests passed on patched Node22.23.4. Independent exact-diff review confirmed capture-only spec changes. Normal native CI is still pending.

Runner compatibility: Playwright 1.64 rejects trace/video options inside a describe because they are worker-scoped. An initial collection check caught this before publication. The policy now uses supported file-level test.use; this spec has no retry-zero overrides. No custom fixture or worker framework was added.

Compatibility verification: the installed Playwright 1.64.0 runner collected all 485 WebKit mobile cases with CI opt-in enabled (exit 0, no collection errors), retaining one retry, 30,000ms timeout and failOnFlakyTests=true. The same opt-out collection had identical test identities (including all 31 bookshelf cases). Four updated source-contract tests passed. This is collection evidence, not browser execution.

## Historical recording-only local verification

Runtime-content HEAD `de81d0cfaa8d3368ae64cc08c16003821b160bda`, tree `6dea96e36868e091f9e44e4d7bbe66697b707850`: `npm run verify` exited 0 on official checksum-verified Node 22.23.4 / npm 10.9.9. Fresh application and regenerated Worker type checks passed; 1,061 test files and 11,118 tests passed (67 skipped, 1 todo); production build passed in 14.89 seconds. Log SHA256: `d6fafe6d3d2409d3d56e042ed64d523f1a3a87f26690be3bca5d6d4fac88bdee`.

Application dependencies were installed from unchanged main manifests using npm ci; isolated Playwright 1.64.0 installation did not mutate those manifests. The only node_modules file modified after the initial inventory was Vitest's generated `.vite` results cache; no package source changed. The generated historical-worker fixture is excluded. Local tests used synthetic data with provider telemetry disabled. Main's installed Undici 7.29.1 remains unpatched here; #833 owns its separate mitigation. Local verification does not replace native browser, Firestore, budget or production gates.

## Month entrance-blur experiment

[Issue #776](https://github.com/kame447/StudyPlanner/issues/776) owns the motion decision.
Serial test-only ABBA runs [39869068216](https://github.com/kame447/StudyPlanner/actions/runs/39869068216),
[39869441180](https://github.com/kame447/StudyPlanner/actions/runs/39869441180), and
[39870053449](https://github.com/kame447/StudyPlanner/actions/runs/39870053449)
used the same production build per run on `5edc4ede`. All 12 first attempts
were included: original A passed 2/6; treatment B passed 6/6. Four A retries
separately passed 1/4. All three settled A/B/A-repeat gates passed exact
geometry and zero changed RGBA pixels at 1280x900, DPR 3; independent PNG
decoding confirmed all six pairs.

The contrast supports an entrance-filter cost contribution under these runner
conditions. Small samples, different hosts and ordered execution limit the
conclusion; the first host passed both A attempts. E is carryover-sensitive;
result durations include teardown and do not quantify body-deadline margin.
These isolated runs do not replace the failed normal Matrix.

Owner decision 2 remains pending: remove only four blur declarations from
`month-day-sheet-backdrop-in`, retaining static blur 3px while the entrance
background alpha animates. Entrance motion changes; sampled settled pixels
match. Exit and panel motion remain unchanged. Day 1280 and Bookshelf #805
remain unresolved. The temporary diagnostic is removed without adopting any
production change; Issue #776 tracks the decision and subsequent verification.
