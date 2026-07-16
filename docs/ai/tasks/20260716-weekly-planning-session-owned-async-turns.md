# 週間計画の非同期turnと承認をsession所有にする

Status: closed
Created: 2026-07-16
Closed: 2026-07-16
Parent: `20260716-weekly-planning-conversation-hardening-review-fixes.md`

## 目的

modal内componentのmount状態に依存していた週間計画turnと一括承認を、週単位の`PlanningState`へ集約する。古いrequest、別週のrequest、途中でrevisionが変化したrequestが、新しいsessionを上書きできないようにする。

## 責務分割

### `weeklyPlanningReducer`

- `revision`を単調増加させる
- `pendingTurn`と`pendingApproval`の所有者になる
- request ID、週、base revisionが一致する結果だけをcommitする
- turn中と承認中の競合mutationを拒否する
- session resetで会話、intake state、未承認draftをまとめて削除する

### `weeklyPlanningTurnExecutor`

- AI設定、interpreter、pipeline、dialogue rendererの実行だけを担当する
- React stateやmodal lifecycleを参照しない
- state、表示message、draft candidateを戻り値として返す

### `App`

- reducerからrequest ownershipを取得して非同期処理を開始する
- executor結果を同じpending identityでcommitする
- 一括承認をsnapshotしたdraft IDsとapproval identityで実行する
- stale resultをUIへ反映しない

### `QuickEntryModal`

- 保存済みsessionの有無から初期入力方法を一度だけ決定する
- 親から受け取ったsession controllerを`NaturalLanguageAssistant`へ渡す
- pipelineやsession更新規則を持たない

### `NaturalLanguageAssistant`

- 週間計画の会話表示、入力、local preview表示を担当する
- weekly planning pipelineを直接実行しない
- pending turn中はcomposerを隠し、typing indicatorを表示する
- pending approval中は表示可能な全mutationを無効化する

### `weeklyPlanningStorage`

- version付きenvelopeを検証する
- future version、破損message、破損draft、破損intake stateを受理しない
- `pendingTurn`、`pendingApproval`、`assumptionProposalRecords`を永続化しない

## 実装内容

- `PlanningState.revision`
- `WeeklyPlanningPendingTurn`
- `WeeklyPlanningPendingApproval`
- begin/commit/fail/cancel turn action
- begin/complete/fail approval action
- reducer-level mutation lock
- modal close/reopen時のAI・週間計画画面復元
- intake-only sessionでもreset操作を表示
- 「この週の相談をリセット」で未承認draftも削除
- Week/Day viewの個別削除も処理中は無効化
- storage v2とlegacy migration

## テスト方針

個別の再現テストを大量に追加するのではなく、境界ごとに次の構成へ分けた。

1. reducerの具体例テスト
2. fast-checkによる状態不変条件のproperty-based test
3. storage境界テスト
4. modalのSSR接続テスト
5. 全既存テスト

property-based testでは、次の不変条件を任意のrequest identity・mutation列に対して検証する。

- stale requestはcommitされない
- pending turn中の任意mutation列でsessionが変化しない
- pending approval中の任意draft mutation列でdraft集合が変化しない
- 受理された通常mutationではrevisionが単調増加する

## 完了条件

- [x] request ID、weekStartDate、baseRevisionが一致するturnだけcommitする
- [x] modalを閉じてもpending状態は親sessionに残る
- [x] pending turn中に新しいturnやdraft mutationを受理しない
- [x] 別週へ移動した後の旧turn結果をcommitしない
- [x] approval中の個別削除・一括破棄・別mutationを拒否する
- [x] 保存済みsessionがある場合、modal外側からAI入力を再開する
- [x] intake-only sessionにもresetを表示する
- [x] resetで会話、intake state、未承認draftを削除する
- [x] pending ownershipをlocalStorageへ保存しない
- [x] future storage versionと破損stateを拒否する
- [x] property-based testで状態不変条件を固定する
- [x] modal接続をSSR integration testで固定する
- [x] 全テストとproduction buildを通す
