# 進行中承認をreset・週変更で中断可能にする

Status: planned
Priority: P1
Requirement IDs: DA-PREVIEW-001
Updated: 2026-07-18

## 1. 背景

2026-07-18の全体監査で、承認実行中(保存await中)にセッション初期化や週変更が起きても、残りitemの保存が続行されることを確認した。

観測事実:

- reducerは`reset_session`を`pendingApproval`中でも許可する(`src/features/weeklyPlanning/weeklyPlanningReducer.ts:115-122`)。resetは`pendingApproval`を消し、draftBlocksを破棄する。
- `executeWeeklyDraftApproval`(`src/features/weeklyPlanning/planning/weeklyPlanningApproval.ts:294-354`)はitemループ中に外部状態を再確認せず、全itemの保存を完了まで続行する。
- `useWeeklyPlanningState`は週変更・ユーザー変更で状態を丸ごとロードし直し、`pendingApproval`はload時にstripされる。承認application層はこれを検知しない。
- 結果、ユーザーが「破棄」または週移動した後も、破棄済みの仮予定がFirestoreへ通常予定として保存される。`complete_approval`はrequestId不一致でno-opになるため完了メッセージは出ず、ユーザーは保存に気づかない。
- ledgerには`onOperationCompleted`で記録されるため、後から再承認しても重複はしない。問題は保存自体がユーザー意図に反することと、無通知であること。

## 2. 目的

承認開始後に`pendingApproval`の所有権が失われた場合(reset、週変更、状態ロードし直し)、未保存itemの保存を行わない。保存済み分の記録は失わない。

## 3. 計画書との対応

- product spec: `docs/weekly-planning/weekly-planning-spec.md`(破棄操作のUX)
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`(request invalidation)
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: DA-PREVIEW-001

## 4. Entry conditions

- `main` 37b1146以降で、`approveWeeklyPlanningDraftBlocks`→`executeWeeklyDraftApproval`のitemループと`dispatch`/`getState`の受け渡しを再調査する。
- `executeWeeklyDraftApproval`はdomain層であり、React stateを直接参照させない設計を維持できるか確認する(継続判定callbackの注入で対応する)。

## 5. 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/planning/weeklyPlanningApproval.ts`(`ExecuteWeeklyDraftApprovalDependencies`へ継続判定`shouldContinue(): boolean`等を追加。未指定時は現行挙動)
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts`(`getState().pendingApproval`の同一性を継続判定として注入。中断時のoperation status確定とledger記録)
- 新規: なし
- テスト:
  - `src/features/weeklyPlanning/planning/weeklyPlanningApproval.test.ts`(中断時に残りitemが保存されない)
  - application層の挙動テスト(reset競合。`20260718-weekly-planning-application-behavior-tests.md`のharnessを利用)

## 6. 現在の処理経路

```text
approveDraftBlocks
→ begin_approval(pendingApproval設定)
→ executeWeeklyDraftApproval(itemごとにfindExistingPlanId → saveBlock)
   ← この間のreset_session / 週変更 / load_stateを検知しない
→ onOperationCompleted → complete_approval(requestId不一致ならno-op)
```

## 7. 確認済みの事実

- reducer単体・controller単体のテストは存在するが、承認application層との競合(reset中のin-flight保存)を検証するテストはない。
- cancel操作は`pendingTurn`のみを対象とし、承認には中断導線がない(UI仕様として承認中の破棄ボタンは無効化されている)。

## 8. 未確認事項

- 中断時にoperationを`partially_saved`として記録した場合の、既存retry UI文言との整合。
- 週変更が承認中に起きる主要因は保存副作用(`20260718-weekly-planning-approval-save-side-effect-isolation.md`)であり、同taskの完了後にこの競合の発生頻度がどこまで残るか。

## 9. 問題点

- ユーザーの「破棄」操作後にバックグラウンドで保存が続くのは、AI behavior rules(destructive changes without confirmationの回避、reviewable apply)の精神に反する。
- 保存が無通知で行われるため、画面上の状態とFirestoreの実データが乖離する。

## 10. 修正方針

- domain層(`executeWeeklyDraftApproval`)には継続判定callbackだけを追加し、判定自体はapplication層が注入する。状態遷移・保存規則は変えない。
- application層は各itemの保存前に`getState().pendingApproval?.requestId === pending.requestId`を確認し、失われていれば以降のitemを保存せず、その時点までの結果でoperationを確定してledgerへ記録する。
- 中断されたoperationは`partially_saved`または`pending`として残し、既存のretry経路(existingOperation再利用)で再開可能にする。

## 11. 触らない範囲

- 承認中UIへの中断ボタン追加(UX変更は別判断)
- reducerの遷移規則(`reset_session`の許可自体は維持する)
- server-side永続化(`20260716-weekly-planning-approval-persistence-and-idempotency.md`の範囲)
- scheduler、preview生成

## 12. 受け入れ条件

- 承認開始→1item保存完了→reset_session→残りitemが保存されない。
- 中断時点までに保存されたitemはledgerへ`saved`として記録され、再承認時に`skipped_duplicate`または既存operation再利用で重複しない。
- 中断が発生しない通常経路(全成功、部分失敗、全失敗)の挙動が変わらない。
- 中断時に`complete_approval`/`fail_approval`の誤適用が起きない(requestId同一性ガードを維持)。

## 13. テスト観点

- unit: `shouldContinue`がfalseを返した時点で残りitemが`pending`のまま保存されない。
- integration: 実reducer + fake保存関数で、保存await中にreset→保存回数と最終状態を検証。
- browser/manual: 承認直後に破棄を連打しても、破棄後の予定が週表示・日表示に現れない。
- regression: 部分失敗→再試行、二重クリック防止。
- property/fuzz: 不要。

## 14. リスク

- 中断判定の追加により、保存とledger記録の間の失敗窓が変わる。ledger記録は中断確定時に必ず行うこと。
- `20260718-weekly-planning-approval-save-side-effect-isolation.md`と同一ファイルを変更するため、直列に実施する。

## 15. Dependencies

- 先行推奨: `20260718-weekly-planning-approval-save-side-effect-isolation.md`(週変更由来の競合の主要因を先に除去)。
- 並行変更禁止: `weeklyPlanningApprovalApplication.ts`、`weeklyPlanningApproval.ts`を触る他task。

## 16. Exit conditions

- focused test、週間計画suite、全test、TypeScript、production build、`git diff --check`が成功する。
- 中断時のoperation statusとretry再開の仕様を文書化する。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
