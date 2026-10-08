# Scheduled pixel student

Status: closed implementation record
Completed: 2026-10-08
Current contract: [Client Runtime — Scheduled Home decoration](../../../domains/client-runtime/README.md#scheduled-home-decoration)
Release: [PR #539](https://github.com/kame447/StudyPlanner/pull/539)

## Outcome and scope

The ordinary pixel classroom/study scene follows its displayed occurrence and the existing Home display clock. Before start it is empty. Opening or returning to an already-active occurrence starts seated. A start boundary observed in the current scene lifetime triggers side entry, seating and study; motion disabled or reduced-motion uses a static seated state. Date, end, occurrence, owner and unmount changes cancel obsolete entry. Preview stays a static sample.

There are no schedule, Actual, AI or storage-schema changes, and no persistent animation flag. Companion, cozy and minimal scenes retain their behavior. The existing scene/live-clock history is #482/#523, #525/#527 and #528/#531; companion planter spacing is a separate change.

## Release identity

- Final local: `9cef0578ae1e888ac8ccda612dc0b18dc3d53ae5`
- PR head: `2ddc6cd5b00ac88b2352104059b0616d8aaa17fc`
- Verified tree: `13399c570648651f10b15dff8892787f4a48504b`
- Main merge: `22847120386987329e2f034d6062d59694ef1180`, parents `81090a667d8b04022e18ee78129dc7894811d8f1` and the PR head
- Final local, published head and main trees were identical.

## Verification before merge

Exact runtime input `485a87f890da3fadf0fc6d31d799cf50c932ee68` / tree `77622b6182334ea1e6409826d84b329d25fc4222` passed fresh `npm run verify`: 759 files / 6,144 tests passed, 45 skipped / 1 todo, app/Worker types and build 7.24s. All tracked input hashes, 237 installed package versions and generated Worker types matched before/after. All eight budgets passed: JS 2,241,450 raw / 602,662 gzip; CSS 484,128 raw / 81,302 gzip. Only the verification document changed after this runtime proof.

The final PR passed [CI](https://github.com/kame447/StudyPlanner/actions/runs/37722169628), [Browser](https://github.com/kame447/StudyPlanner/actions/runs/37722169622) with 434 passed, [Matrix](https://github.com/kame447/StudyPlanner/actions/runs/37722169664) with 322 passed / 3 intentional skips and visual success, [Quality](https://github.com/kame447/StudyPlanner/actions/runs/37722169701), and [Admin](https://github.com/kame447/StudyPlanner/actions/runs/37722169695). All 20 student cases in each browser passed on their first attempt. Chromium/WebKit screenshots at 390/1280px for classroom/study were inspected. A subsequent exact-head [CI](https://github.com/kame447/StudyPlanner/actions/runs/37723840805) also passed before merge.

## Post-merge acceptance

The exact main commit separately passed [CI](https://github.com/kame447/StudyPlanner/actions/runs/37723848103), [Browser](https://github.com/kame447/StudyPlanner/actions/runs/37723848152) with 434 passed, [Matrix](https://github.com/kame447/StudyPlanner/actions/runs/37723848001) with 322 passed / 3 intentional skips and four visual cases, [Quality](https://github.com/kame447/StudyPlanner/actions/runs/37723848093), and [Admin](https://github.com/kame447/StudyPlanner/actions/runs/37723848035). Browser job `113137724221` and cross-browser job `113137401254` each recorded all 20 student cases passing; visual job `113137401535` recorded four passes. Pages check `113137547060` succeeded for [this deployment](https://45021ca1.studyplannner.pages.dev).

This accepted combined main also contains the responsive-header repair. The previous header-only main's Browser run was cancelled; its missing terminal evidence is not rewritten as success or substituted for this separately completed combined-main run.

## Regression history

Focused coverage includes real Home/card/live-clock/scene behavior, exact local start, timed seating, active mounts, reload/navigation, hidden start and return, adjacent plans, end/next plan, local midnight, off/reduced motion, runtime motion changes, owner/reschedule replacement and unchanged storage. The initial 60 focused cases passed; the same 12 student cases also passed separately in Tokyo and New York.

A clock-fixture race at the initial/reload start boundary was corrected without changing product timing. A mobile-WebKit job was cancelled after system-package installation consumed 21m44s of its 25-minute limit, before the student cases. The same-head retry completed with 310 passed / 3 skipped, no unexpected/flaky tests, and all 20 student cases successful. That cancellation was retained as missing evidence until the retry completed.

Only the two mobile Home student goldens changed for the deliberately empty pre-start scene. Against the reviewed header images each difference contained 1,365 pixels within x=288–324 / y=176–239; other pixels and six sibling goldens were unchanged. The final shared-footer correction was subsequently integrated and reverified. No timeout, image threshold, mask or flaky-test policy was weakened.

Aggregate JavaScript guards were calibrated once after the independent final-feature size audit to raw 2,260,000 / gzip 608,000; the other six guards stayed unchanged. This was recorded separately from runtime/browser behavior, and all final guards passed.

## Environment and limits

Local verification used Linux x64, Node 24.19.0, npm 11.9.0, React/react-test-renderer 18.3.1, Vite 6.4.3, Vitest 3.2.7, TypeScript 5.9.3 and Wrangler 4.143.1. The 237 installed packages matched lock SHA-256 `0cc1f34fa1ead88aab107a9cd1f91e00575d514d45406a5ec452d98b71bfdbb5`; no dependency or lock update was introduced.

Static SVG rasterization verifies artwork bounds only. CI animation-frame and browser screenshots provide separate runtime evidence. Physical-iPhone interaction and authenticated production operation remain unverified.

## Published checkpoint provenance

The [full pre-closure technical checkpoint](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/docs/domains/client-runtime/work/20261007-pixel-scheduled-student.md) remains available at the accepted release commit. Its dated intermediate states are historical, not current status.
