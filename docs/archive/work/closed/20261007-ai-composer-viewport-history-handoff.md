# AI入力時のviewportと会話履歴の表示

Status: closed implementation record
Completed: 2026-10-08
Current contract: [Weekly Planning — AI conversation viewport](../../../domains/weekly-planning/README.md#ai-conversation-viewport)
Release: [PR #537](https://github.com/kame447/StudyPlanner/pull/537)

## Outcome and scope

AI入力時の可視領域縮小・縦panに専用shellを追従させ、入力欄と既存会話を同じ可視領域に保つ。末尾を読んでいた場合は末尾、過去の会話を読んでいた場合はそのscroll位置を維持する。通常のpinch zoom中は寸法を書き換えず、画面終了時にlistenerと専用CSS値を復元する。

表示制御だけを変更した。意味解釈、PlanningState、保存済み会話内容、予定の保存、通常入力focus、他surfaceのbody/root scroll lockは変更しない。入力前16pxと自動focus禁止の既存方針も維持する。以前の入力修正は #193/#194 と #209/#210、意味解釈・会話継続は #488 の別scope。

## Accepted release identity

- Final local: `0dac12851432fee925b31e875e206798e28d2fd9`
- PR head: `42f00f46dcd4a205f8c45f27fcf573e15f2b9873`
- Verified tree: `ae4b3fdf3cee3e095963bafe75f12eab0e2c059a`
- Main merge: `50c41f355adb722c0170dbe6efbaca02266a4fb6`, parents `da2e60e9d508d070567dc6fc1764fd4cd066fd89` and the PR head
- Local, published head, CI merge and main content trees were identical.

## Verification

The clean runtime input `503c0779aef962285f8821665703ce14dd428599` passed fresh `npm run verify`: 758 files / 6,132 tests passed, 45 skipped / 1 todo, app and regenerated Worker typechecks, production build 7.86s. All eight bundle guards passed. The later mobile-WebKit change touched only an independent E2E file and its record; runtime, unit, type, build and installed-dependency inputs remained identical. Its changed browser behavior was verified separately on the final PR.

The final PR passed [CI](https://github.com/kame447/StudyPlanner/actions/runs/37710278293), [Browser](https://github.com/kame447/StudyPlanner/actions/runs/37710278320) with 385 passed, [Matrix](https://github.com/kame447/StudyPlanner/actions/runs/37710278302) with 199 cross-browser passed / 3 intentional skips and all visual cases, [Quality](https://github.com/kame447/StudyPlanner/actions/runs/37710278442), and [Admin](https://github.com/kame447/StudyPlanner/actions/runs/37710278297). The new AI viewport cases passed six each in Chromium and mobile WebKit. Final 360/390/402px screenshots were inspected and their matching content hashes checked.

The exact main commit separately passed [CI](https://github.com/kame447/StudyPlanner/actions/runs/37712016312), [Browser](https://github.com/kame447/StudyPlanner/actions/runs/37712016223) with 385 passed, [Matrix](https://github.com/kame447/StudyPlanner/actions/runs/37712016289) with 199 passed / 3 intentional skips and visual success, [Quality](https://github.com/kame447/StudyPlanner/actions/runs/37712016271), and [Admin](https://github.com/kame447/StudyPlanner/actions/runs/37712016305). Cloudflare Pages check `113100021504` succeeded for [this deployment](https://706d7880.studyplannner.pages.dev).

## Investigation and regression history

- The original 100dvh shell did not account for VisualViewport shrinkage and vertical offset. Existing pre-focus font sizing and conversation persistence were retained rather than treating the report as lost history.
- Initial focused checks passed 73 tests across the viewport hook, persistence, image ownership and module recovery. The source-only focus-policy guard passed separately.
- The first browser fixture captured a height before viewport metadata settled. It was corrected to use the configured device dimensions; production code was not changed for that harness failure.
- Mobile WebKit does not implement `mouse.wheel` in the selected Playwright backend. The final harness verifies scrollability, establishes the old-message position via DOM only on that backend, then exercises real layout/position retention. Chromium continues to use native wheel input. No overflow threshold, assertion or relevant case was removed.
- Regression scope includes 360/390/402px widths, short viewport height and offset/pan, old-message reading, multiline input, repeated keyboard-size cycles, navigation cleanup, zoom, desktop keyboard operation, and preview scroll ownership.

## Environment and limits

Local verification used Linux x64, Node 24.19.0, npm 11.9.0, Vitest 3.2.7 and Playwright 1.62.1. All 237 installed application package versions matched the lock before/after; lock SHA-256 `0cc1f34fa1ead88aab107a9cd1f91e00575d514d45406a5ec452d98b71bfdbb5`. No dependency or lock change was required.

Headless browser checks use synthetic viewport changes and do not establish physical-iPhone keyboard, pan, IME or touch behavior. Those device checks and authenticated production interactions remain unverified. Direct deployment content retrieval returned HTTP 403, so Pages success is not described as a successful public-asset comparison. Local browser execution was restricted; CI execution, collected tests and static/source checks are kept distinct.

## Published checkpoint provenance

The [full pre-closure technical checkpoint](https://github.com/kame447/StudyPlanner/blob/50c41f355adb722c0170dbe6efbaca02266a4fb6/docs/domains/weekly-planning/work/20261007-ai-composer-viewport-history-handoff.md) remains available at the accepted release commit. Its dated intermediate states are historical, not current status.
