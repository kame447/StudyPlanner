# Week / Day all-day and multi-day presentation

Status: active
Owner: Issue #284
Branch: `fix/issue284-week-layout-readability`
PR: #289
Base: `897282a892f4ef720b5f3d56cadf48dce0c6b366`
Updated: 2026-09-05

## Goal

週表示・日表示で終日 / 日跨ぎ予定を時間グリッド上部へ分離しつつ、通常の時間指定予定の幅と、上部レーンの可読性を壊さない。

PR #285 で分離自体は実装済みだが、実機相当の週表示で次の未達が確認されたため #284 を再オープンした。

1. 同一日の通常予定が、時間的に重複していない場合でも不必要に横幅を分割されることがある。
2. 終日 / 日跨ぎカードの文字が通常予定より小さく、利用可能幅を使い切る前にタイトルが省略される。

## Current product contract

### Spanning occurrence classification

presentation classification は canonical `ScheduleOccurrence.start/end` だけから決める。

`occurrence.start.date !== occurrence.end.date` の occurrence は hourly grid に入れず、上部 lane へ送る。

この条件には次が含まれる。

- 00:00〜翌日00:00として正規化された終日予定
- 23:00〜翌01:00などの日跨ぎ予定
- 複数日 MonthEvent

同一日内で完結する通常予定は hourly grid に残す。

### Week timed-event width

- 同一日の timed event は、実際に時間区間が重なる場合だけ横幅を分割する。
- `end === other.start` の境界接触は重複ではない。
- 非重複予定は、その日の通常イベント領域の幅を利用する。
- spanning lane の存在や同日の別時刻予定によって lane count / width を引きずらない。

### Week spanning lane readability

- 日付headerと00:00時間軸の間に専用レーンを置く。
- 左端に `終日` labelを置く。
- 複数日 occurrence は week boundary へ clip して対象曜日をspanする。
- 同時に複数のspanが重なる場合だけ row を追加する。
- 通常予定セルと同等の文字サイズ・文字密度を使う。
- カード内の利用可能幅をタイトル表示へ最大限使い、本当に収まらない場合だけ ellipsis を使う。
- 複数日カードはspan全体の幅をタイトル表示へ利用する。
- `data-schedule-occurrence-id` を維持して既存のclick / long-press delete境界を再利用する。

### Day spanning strip

- hourly grid直前に compact stripを置く。
- clickで既存detail selectionへ遷移する。
- `data-schedule-occurrence-id` を維持する。
- spanning occurrenceをhourly plan entriesから除外する。
- Actualはhourly gridに残す。

## Non-goals

- ScheduleEvent / ScheduleOccurrence persistence変更
- recurrence semantics変更
- MonthView変更
- Actual表示方式変更
- 週表示全体のデザイン刷新

## Verification contract

Focused regressionで最低限固定する。

- week: all-day / cross-date occurrence は hourly grid ではなく上部laneに存在する
- week: multi-day occurrence は対象columnをspanする
- week: non-overlapping timed events は full normal width を使う
- week: overlapping timed eventsだけがwidthを分割する
- week: touching intervals (`end === next.start`) はwidthを分割しない
- week: spanning cardの文字サイズが通常timed cardと同等の可読性を持つ
- week: spanning cardが利用可能幅を使う前に不要なellipsisを発生させない
- day: all-day / cross-date occurrence はtop stripに存在しhourly blockから除外される
- day: normal timed occurrence / actual はhourly gridに残る
- long-press delete target attributeをtop blockでも維持する
- mobile viewportでoverflowしない

その後 TypeScript / full tests / production build / Browser Regression / UI Regression Matrix / UI Quality Automation を exact HEAD で terminal greenまで追う。

## Checkpoint

### 2026-09-04 initial implementation

- Issue #284 created
- branch `fix/issue284-all-day-multiday-lanes`
- PR #285
- canonical `ScheduleOccurrence.start/end` based classification helper追加
- week: spanning eventをcompact date-spanning laneへ分離
- day: spanning eventをcompact top stripへ分離
- focused classification / week / day regression追加

### 2026-09-05 first merge

- PR #285 squash merged to main as `897282a892f4ef720b5f3d56cadf48dce0c6b366`
- Issue #284は一度completedとしてclosed
- source treeとしてはPR検証treeとsquash merge treeが一致

### 2026-09-05 reopen

- 実機相当スクリーンショットで以下を確認
  - 8/24の通常timed eventが非重複でも部分幅になっている
  - 上部laneのタイトルが通常セルより小さく、早すぎるellipsisが発生している
- Issue #284をreopen
- same-task active Issue / PRなしを再確認
- old branch `fix/issue284-all-day-multiday-lanes` は squash merge 後に main と divergedしており、新しいreview diffのheadとしては使わない
- new active branch `fix/issue284-week-layout-readability` を exact main `897282a892f4ef720b5f3d56cadf48dce0c6b366` から作成
- Draft PR #289 を同branchから作成し、Issue / MD / PRを同じfollow-up scopeへ統一
- old branchはhistorical merged branch。明示許可なしでは削除しない

### Competing hypotheses before code edit

Timed width:

1. overlap lane builderが日全体の最大lane数を各イベントへ誤って適用している。
2. overlap判定が境界接触や別時刻イベントを重複として扱っている。
3. CSS / block style側に固定width・max-widthがあり、lane計算とは無関係に狭くなっている。

Spanning text:

1. spanning card専用CSSのfont-sizeが通常timed cardより小さい。
2. grid/span計算は正しいが、padding / gap / max-widthがタイトル領域を過剰に削っている。
3. DOM側で固定の短縮文字列を生成しており、CSS ellipsis以前に文字が切られている。

### 2026-09-05 diagnosis and fix

- timed width hypothesis 1 confirmed:
  - existing `buildLanes` correctly expired `end <= next.start`, so boundary-touching intervals were already non-overlapping
  - however the maximum lane count observed anywhere in a day was copied to every event in that day
  - result: one overlap pair could make unrelated morning / afternoon events remain half-width
- timed width hypotheses 2 and 3 rejected as primary causes
- `buildLanes` now finalizes lane count per overlap-connected cluster instead of per whole day
  - overlapping cluster keeps split width
  - a later non-overlapping cluster starts again at full width
  - `end === next.start` creates a new cluster and therefore remains full width
- spanning text hypothesis 3 rejected: the DOM already retains the complete `occurrence.title`; truncation was CSS overflow, not pre-shortened data
- spanning text hypotheses 1 and 2 confirmed:
  - dedicated card used different typography and larger horizontal inset than normal timed cards
  - card title font is aligned to the normal timed-card title (`0.5rem`, weight `850`)
  - horizontal margin/padding reduced to `2px 1px` / `2px 2px` so the title uses substantially more of the available grid span
  - `終日` label font size is aligned as well
- regression-first sequence:
  - commit `a659660fa7df66fcef219cb36dad2413d3c8af95` added focused unit regressions before production fix and correctly made CI fail in `Run tests`
  - production fixes then made TypeScript and full unit tests pass on head `3bf70552bfc417e1958777da4b414a9be22d9df6`
- browser harness `week-layout-readability` added to verify at 390px viewport:
  - real overlapping events are narrow
  - unrelated / boundary-touching events use normal full width
  - spanning-card computed title size equals normal timed-card title size
  - a four-character Japanese title fits without overflow after using the available card width

Next action: this checkpoint commit is documentation-only. Require a fresh exact-HEAD run of CI / Browser Regression / UI Regression Matrix / UI Quality Automation / Admin Overview Render, audit the final PR diff, then Ready + squash merge if every gate is terminal green.
