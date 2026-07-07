# 日付表示からの仮予定の個別削除導線を復活させる(UI regression)

WeeklyPlanDraftBlock MVP では、仮予定の個別削除・一括破棄・一括承認が基本操作だった。現在、日付ごとの表示から仮予定を個別削除できない。renderer / scheduling とは別の **UI regression** として扱う。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 確定している事実 / 調査前提

コード確認済み:

- `WeekView` / `DayView` / `DayTimeline` はいずれも `onRemoveWeeklyDraftBlock?: (blockId) => void` prop を持ち、削除ボタン(「仮予定を削除」)の描画コードも存在する(WeekView 475-484行、DayView は子へ 919行で伝播)。
- `NaturalLanguageAssistant` の仮予定削除ボタンは `!hasLocalWeeklyPlanningPreview && onRemoveWeeklyDraftBlock`(1265行付近)で条件付き。つまり **ローカルの preview 段階(promote 前)では削除ボタンが出ない**。
- 承認前 `WeeklyPlanDraftBlock`(promote 後)には削除導線があるが、preview 段階の block と、日付表示(WeekView/DayView)へ渡す block の識別・callback 配線に不整合がある可能性。

判定: UI 側に削除 prop と描画は存在するが、**preview 段階/日付表示経路で個別削除 callback が実質配線されていない**のが有力。Phase 1 で「preview 段階 vs promote 後 draft 段階」「WeekView(overview)vs DayView(日付別)」のどの組合せで削除できないかを実 UI 状態で切り分ける。

## 実装範囲

- Phase 1 で特定した「個別削除できない経路」に対し、削除 callback を配線する。preview 段階の仮予定も日付表示から個別削除できるようにする(MVP の基本操作の復活)。
- 一括破棄・一括承認が同時に失われていないかも確認し、失われていれば同一 UI regression として復活対象に含める(共通原因なら本タスク、別原因なら分離報告)。
- draft identity(blockId)が preview/promote 段階で一貫し、削除が正しい block を対象にすることを担保する。

## 回帰テスト

- UI ロジック層でテスト可能な範囲(削除 callback が正しい blockId で呼ばれる、preview 段階でも削除導線が有効)をコンポーネントテストで固定する。
- draft identity の一貫性(preview → promote で blockId が保たれる)をユニットで固定できるなら固定する。
- 純粋な描画のみの変更でテストが書けない部分は、Phase 1 の切り分けと手動確認手順を報告に残す。

## 完了条件

- 日付ごとの表示から仮予定を個別削除できることが復活し、可能な範囲でテスト固定されている。
- 一括破棄・一括承認の状態も確認・報告されている。
- 既存テスト全 green、build 成功。

## 触らない範囲

- scheduling / generator / 生成ロジック。
- renderer / AI interpreter / dialogue。
- 承認後の保存導線(savePlanDraft)の仕様変更。
- WeekView/DayView のレイアウト・CSS 大改修(削除導線の配線に必要な最小限に留める)。

## 停止条件

- 個別削除不能の原因が draft identity / state 管理の設計変更に及ぶとき(切り分けを報告して判断を仰ぐ)。
- 変更が weekly draft の UI コンポーネント群と対応テストの外へ波及するとき。
- 説明できない新規テスト失敗が出たとき。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
