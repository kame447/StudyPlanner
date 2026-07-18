# 週間計画承認の保存経路を画面副作用から分離する

Status: planned
Priority: P1
Requirement IDs: DA-PREVIEW-001
Updated: 2026-07-18
Depends on: `20260718-weekly-planning-app-orchestration-extraction.md`(completed)

## 1. 背景

2026-07-18の全体監査で、仮予定承認が`usePlannerDataState.ts`の`savePlanDraft`を保存プリミティブとして使っていることによる実バグを確認した。

観測事実:

- `savePlanDraft`は保存のたびに`setSelectedDate(nextPlan.date)`、`setMonthDate(...)`、`closePlanEditor()`を実行する(`src/hooks/usePlannerDataState.ts:924-929`)。
- `useWeeklyPlanningState`は`selectedDate`から導出した`weekStartDate`をkeyに状態をロードし直す(`src/features/weeklyPlanning/useWeeklyPlanningState.ts:35-37`)。
- 仮予定の日付が選択週の外にある場合(「来週の計画」フロー。`pendingPlanningRange`の`next_week` scopeが存在する)、承認1件目の保存でselectedDateが別週へ移動し、承認中の週間計画状態が別週の状態へ差し替わる。`pendingApproval`は消滅し、`complete_approval`はno-opになる。
- 結果、planは保存されるが、仮予定は旧週のlocalStorageへ未承認のまま残り、成功メッセージも表示されない。
- `savePlanDraft`は`targetPlanId ?? editingPlanId`へフォールバックする(`src/hooks/usePlannerDataState.ts:917`)。編集セッションと無関係な承認保存が、編集中planの上書きやrecurring編集の早期return(保存せず成功扱い)へ化ける潜在経路がある。現状はPlanEditorPanelがフルオーバーレイのため実質到達不能だが、契約として危険である。
- `saveBlock`は実planIdを返せず、擬似ID `weekly-plan:<sourceDraftBlockId>` をledgerへ記録している(`src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts:113`)。

## 2. 目的

週間計画承認が、画面遷移・編集セッション・通知の副作用を持たない保存プリミティブを使い、承認中に週間計画状態が自壊しない。保存結果は実planIdとして記録される。

## 3. 計画書との対応

- product spec: `docs/weekly-planning/weekly-planning-spec.md`(承認して保存のUX)
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`(save boundary)
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: DA-PREVIEW-001

## 4. Entry conditions

- `main` 37b1146以降を対象に、`approveWeeklyPlanningDraftBlocks`→`savePlanDraft`→`plannerRepository.upsertPlan`の経路を再調査する。
- 週外日付の仮予定を実際に生成できる入力(next_week scope)をtest fixtureとして確認する。
- `20260716-weekly-planning-approval-persistence-and-idempotency.md`のserver-side設計と保存契約が競合しないことを確認する。

## 5. 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.ts`(注入する保存関数の差し替え)
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts`(実planIdの記録)
  - `src/App.tsx`(週間計画へ渡す保存依存の選択。画面遷移する`savePlanDraft`ではなく保存専用関数を渡す)
  - `src/hooks/usePlannerDataState.ts`(副作用なし保存関数の公開。既存`savePlanDraft`の挙動は変えない)
- 新規: なし(必要なら保存プリミティブ用の小さなadapter)
- テスト:
  - `src/features/weeklyPlanning/application/`配下の挙動テスト(`20260718-weekly-planning-application-behavior-tests.md`のharnessを利用)

## 6. 現在の処理経路

```text
NaturalLanguageAssistant.handleApproveWeeklyDrafts
→ useWeeklyPlanningApplication.approveDraftBlocks
→ approveWeeklyPlanningDraftBlocks (validate → executeWeeklyDraftApproval)
→ dependencies.saveBlock → savePlanDraft(usePlannerDataState)
→ setPlans / setSelectedDate / setMonthDate / closePlanEditor / plannerRepository.upsertPlan
```

## 7. 確認済みの事実

- 全テスト1163件と本番build成功(37b1146)。既存テストは`savePlanDraft`を副作用のないmockで代替しており、この経路のバグを検出できない。
- 同一週内の承認では`weekStartDate`が変わらないため状態差し替えは起きない(selectedDateの移動と複数toastのみ)。
- 承認後に旧週へ戻って再承認すると、memo markerの重複判定で`skipped_duplicate`となり自己修復する。

## 8. 未確認事項

- 実ブラウザでのnext_week承認の再現(Issue #43の実ブラウザ確認と合わせて行う)。
- optimistic updateされた`plans`と週間計画の重複判定の間のタイミング差。

## 9. 問題点

- 保存プリミティブに画面遷移・編集セッション・通知という別責務が混在し、承認applicationがその副作用を前提にできない。
- 保存結果のplanIdが実IDでないため、承認履歴と通常予定の照合力がない(server-side idempotency設計の障害になる)。

## 10. 修正方針

- application層の修正とする。会話解釈、reducer遷移、schedulerには触れない。
- `usePlannerDataState`に「予定をupsertし実planIdを返すだけの関数」(例: `savePlanFromWeeklyApproval`)を追加し、週間計画へはそれを注入する。楽観更新(`setPlans`)は維持してよいが、selectedDate/monthDate変更・editor閉鎖・編集セッション参照は行わない。
- `saveBlock`は返却された実planIdを`savedPlanId`としてledgerへ記録する。
- 既存`savePlanDraft`の手動予定編集向け挙動は変更しない。

## 11. 触らない範囲

- `savePlanDraft`の手動編集経路の挙動(画面遷移・通知)
- 重複判定方式(memo marker)の変更 — `20260716-weekly-planning-approval-persistence-and-idempotency.md`の範囲
- scheduler、preview生成、承認前検証の内容
- UI文言・CSS

## 12. 受け入れ条件

- 選択週の外の日付を含む仮予定を承認しても、`selectedDate`と`weekStartDate`が変化せず、`pendingApproval`が承認完了まで維持される。
- 承認完了後に`complete_approval`が適用され、保存済みblockが仮予定一覧から消え、完了メッセージが表示される。
- 承認保存が編集中plan(`editingPlanId`)の有無に影響されない。recurring編集中でも承認保存はハイジャックされない。
- ledgerの`savedPlanId`が`plannerRepository`の実planIdと一致する。
- 保存失敗時は従来どおりitemが`failed`となり、部分再試行が動く。

## 13. テスト観点

- unit: 保存プリミティブが画面状態を変更しないこと。実planId返却。
- integration: next_week相当の日付を含む承認で`pendingApproval`維持と`complete_approval`適用を確認(実reducer + 実`useWeeklyPlanningState`)。
- browser/manual: 「来週の計画」を作成し承認 → 画面が現在週のまま、成功メッセージ表示、来週へ移動するとplanが存在する。
- regression: 同一週内承認、部分失敗再試行、二重クリック防止。
- property/fuzz: 不要。

## 14. リスク

- `usePlannerDataState`のAPI追加により、他の保存経路との差異(通知の有無)が生じる。承認完了メッセージは週間計画側の会話メッセージで表示されるため、per-item toastは出さない方針で統一する。
- server-side idempotency設計(先行task)と保存契約が二重に変わらないよう、実planId返却の契約を先に固定する。

## 15. Dependencies

- 先行: なし(単独で着手可能)。
- 並行変更禁止: `weeklyPlanningApprovalApplication.ts`を変更する`20260718-weekly-planning-approval-inflight-interruption.md`、`20260718-weekly-planning-approval-validation-session-binding.md`とは同一ファイルを触るため、着手順を直列にする。

## 16. Exit conditions

- focused test、週間計画suite、全test、TypeScript、production build、`git diff --check`が成功する。
- 変更ファイルと未確認事項(実ブラウザ確認の残り)を最終報告へ記載する。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
