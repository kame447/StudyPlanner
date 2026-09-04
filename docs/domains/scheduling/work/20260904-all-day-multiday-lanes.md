# Week / Day all-day and multi-day presentation

Status: active
Owner: Issue #284
Branch: `fix/issue284-all-day-multiday-lanes`
PR: #285
Base: `697b3d1b11c7d533c019fdedcc5daf5ca1caaeba`
Updated: 2026-09-05

## Goal

週表示・日表示で、終日または日付境界を跨ぐ予定だけを時間グリッド上部の専用領域へ分離する。

通常の時間指定予定は現在の時間グリッド表示を維持する。

## Current behavior

`ScheduleOccurrence` 自体は app-wide の正しい time semantics を持っているが、presentation layer が長い occurrence を通常blockと同じ時間軸へ投影している。

WeekView:

- `scheduleOccurrenceCoversDate` で対象日を抽出する
- 日を跨ぐ occurrence は `scheduleOccurrenceTimesForDate` で当日の `00:00` / `24:00` へ切り出す
- その結果を通常の plan block と同じ `buildLanes` / `buildBlockStyle` へ渡す

DayView / DayTimeline:

- MonthEvent occurrence を選択日に `00:00` / `24:00` へ切り出す
- `DayTimeline` は plan / month-event を区別せず時間軸blockとして描画する

このため終日・複数日予定が巨大な縦長面となり、通常予定の視認性を落とす。

## Decision

presentation classification は canonical `ScheduleOccurrence.start/end` だけから決める。

`occurrence.start.date !== occurrence.end.date` の occurrence は hourly grid に入れず、上部 lane へ送る。

この条件には次が含まれる。

- 00:00〜24:00 が翌日00:00へ正規化された終日予定
- 23:00〜翌01:00などの日跨ぎ予定
- 複数日 MonthEvent

同一日内で完結する予定は現在の hourly layout をそのまま使う。

## Week presentation

日付headerと00:00時間軸の間に dedicated span lane を置く。

- 左端に `終日` label
- occurrence の start/end を week boundary へ clip して対象曜日のcolumn spanを計算する
- 同時に複数の span が重なる場合だけ lane rowを追加する
- blockは既存のtone classを再利用する
- click / long-press delete の `data-schedule-occurrence-id` を維持する
- hourly plan blocksから対象 occurrence を除外する

通常 plan / actual / weekly draft の hourly layoutは変更しない。

## Day presentation

`DayTimeline` のhourly grid直前に compact dedicated stripを置く。

- `終日` labelと該当予定chipを表示する
- clickで既存detail selectionへ遷移する
- `data-schedule-occurrence-id` を維持して長押し削除を利用可能にする
- hourly plan entriesから対象 occurrenceを除外する
- Actualは現在どおり hourly gridに残す

## Non-goals

- ScheduleEvent / ScheduleOccurrence persistence変更
- recurrence semantics変更
- MonthView変更
- 通常timed blockの見た目変更
- Actualの表示方式変更

## Verification

Focused regressionで最低限固定する。

- week: 00:00-24:00 occurrence がhourly gridに存在せず上部laneに存在する
- week: multi-day occurrence が対象columnをspanする
- week: normal timed occurrence はhourly gridに残る
- day: all-day / cross-date occurrence がtop stripに存在しhourly blockから除外される
- day: normal timed occurrence / actual はhourly gridに残る
- long-press delete target attributeをtop blockでも維持する
- mobile viewportでoverflowしない

その後 TypeScript / full tests / production build / Browser Regression / UI regressionをterminal greenまで追う。

## Checkpoint

2026-09-04 initial:

- Issue #284 created
- branch `fix/issue284-all-day-multiday-lanes` created from exact main `697b3d1b11c7d533c019fdedcc5daf5ca1caaeba`
- same-task active Issue / PR / branchなし

2026-09-04 implementation:

- PR #285 opened as Draft
- canonical `ScheduleOccurrence.start/end` based classification helper added
- week: spanning events are removed from hourly blocks and rendered in a compact date-spanning lane under the date header
- day: spanning events are removed from planned hourly blocks and rendered in a compact top strip
- normal timed plans, weekly draft blocks and Actual hourly layout remain unchanged
- top cards preserve `data-schedule-occurrence-id` for the existing long-press action boundary
- DayView selection map now resolves backing Plans on continuation days
- focused tests added for classification, week span placement and day all-day separation
- initial PR run reached TypeScript success, full unit-test success and bundle-budget success before this checkpoint commit superseded that head

2026-09-05 resumed verification:

- exact PR head before resume: `e16d010e136062f5d54b264c9a2504e26275ab19`
- that head had CI / UI Regression Matrix / UI Quality Automation green, but Browser Regression run `33827192995` failed only in the stationary touch-drag regression: nested week scroll changed from `56` to `78`
- the failing `week-plan-drag` harness contains only same-day timed plans, so the new all-day / multi-day lane is not rendered in that scenario
- #284 does not change touch-drag scrolling behavior; the branch was created before PR #283 merged
- PR #283 subsequently added `touch-action: pan-y` to week plan buttons, which prevents the native horizontal pan that produced the observed scroll movement
- current main `7d69f850d2343e08549c67b92f1bf19e3a2215ee` contains #283, and Browser Regression run `33894381335` is terminal green on that exact main
- failure classification: stale-base integration gap, not evidence of a #284 spanning-event production defect and not a transient infrastructure failure
- this checkpoint commit intentionally triggers fresh PR verification so GitHub tests the #284 diff against the current main integration state
- next: require all PR gates terminal green on the fresh head, exact-diff audit, Ready transition, squash merge, then post-merge main verification
