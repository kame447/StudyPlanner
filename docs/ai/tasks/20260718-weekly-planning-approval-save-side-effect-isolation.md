# 週間計画承認の保存経路を画面副作用から分離する

Status: planned
Priority: P1
Requirement IDs: DA-PREVIEW-001
Updated: 2026-07-18
Depends on: `closed/20260718-weekly-planning-app-orchestration-extraction-completion.md`

## 1. 背景

2026-07-18の監査で、仮予定承認が手動編集用の`savePlanDraft`を保存プリミティブとして利用し、保存と無関係な画面副作用を発生させることを確認した。

観測事実:

- `savePlanDraft`は`setSelectedDate`、`setMonthDate`、`closePlanEditor`、notice表示を実行する。
- 週外日付の1件目を保存すると`selectedDate`が別週へ移り、`useWeeklyPlanningState`が別週stateをloadする。
- 承認開始時の`pendingApproval`が失われ、残りの保存は続く一方、`complete_approval`はno-opとなる。
- `savePlanDraft`は`targetPlanId ?? editingPlanId`を参照し、週間承認と無関係なeditor stateに影響される。
- approval applicationは保存後に擬似ID`weekly-plan:<sourceDraftBlockId>`をledgerへ記録している。

## 2. 目的

週間計画承認が、画面遷移、editor state、per-item noticeを持たない保存関数を利用する。保存関数は永続化した`Plan.id`を返し、承認完了まで同じ週間計画stateを維持する。

## 3. 計画書との対応

- product spec: `docs/weekly-planning/weekly-planning-spec.md`の明示承認後保存
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`のsave boundary
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: DA-PREVIEW-001

## 4. Entry conditions

- `approveWeeklyPlanningDraftBlocks`から`plannerRepository.upsertPlan`までの現行経路を再確認する。
- `createPlanFromDraft`が生成するIDとrepositoryへ保存される`Plan.id`が同一であることを確認する。
- `20260718-weekly-planning-application-behavior-tests.md`のdeferred save harnessを利用できる場合は先に取り込む。

## 5. 対象ファイル

- 変更:
  - `src/hooks/usePlannerDataState.ts`
  - `src/hooks/usePlannerAppState.ts`
  - `src/App.tsx`
  - `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.ts`
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts`
- 新規: 必要なら副作用なし保存adapter
- テスト:
  - planner data stateの保存契約test
  - application層の週外日付承認test

## 6. 現在の処理経路

```text
approveDraftBlocks
→ approveWeeklyPlanningDraftBlocks
→ executeWeeklyDraftApproval
→ injected savePlanDraft
→ editor参照
→ plans optimistic update
→ selectedDate / monthDate変更
→ editor close / notice
→ plannerRepository.upsertPlan
```

## 7. 確認済みの事実

- 同一週内の日付ではstate keyが変わらないため、主要な自壊は週外日付で発生する。
- 保存済みplan自体はrepositoryへ入るため、画面上の失敗と永続データが乖離する。
- `Plan.id`はrepository upsert前にclient側で確定する現行設計であり、保存専用関数から返却できる。
- 現行`savePlanDraft`の失敗rollbackはrender時closureで捕捉した`previousPlans`全体へ戻す。複数itemを同一renderで連続保存すると、後続itemの失敗が先行itemのoptimistic entryまで画面上から除去し得る。
- 監査基準`37b1146`の既存testは保存依存を純粋mockにしており、この副作用を再現しない。

## 8. 未確認事項

- optimistic updateの共通化に伴い、手動保存と週間承認でrollback処理をどこまで共有できるか。
- repository成功後、application state更新前に例外が起きる経路があるか。

## 9. 問題点

手動editor向けcommandとrepository保存primitiveが同一関数へ混在し、approval applicationが画面遷移とeditor stateへ暗黙依存している。

## 10. 修正方針

- `usePlannerDataState`に、週間承認専用のcreate保存契約を公開する。契約は概ね`(draft: PlanDraft) => Promise<Plan>`または`Promise<{ planId: string }>`とし、targetPlanIdやeditingPlanIdを受け取らない。
- この保存関数は入力検証、Plan生成、optimistic `setPlans`、repository upsert、失敗時rollbackだけを担当する。
- rollbackは`setPlans(current => ...)`のfunctional updateで失敗した当該Plan IDだけを除去する。render時closureで捕捉した配列全体へ復元せず、同じ承認operation内で先に保存成功したitemのoptimistic entryを維持する。
- `selectedDate`、`monthDate`、editor close、recurring scope dialog、noticeを変更しない。
- `usePlannerAppState`を通じてAppへ公開し、Appは週間計画applicationへこの関数を渡す。
- application側の依存名を`savePlanDraft`のまま流用せず、画面副作用なしの契約であることが分かる名前へ変更する。
- approval ledgerの`savedPlanId`には返却された永続`Plan.id`を記録する。
- 手動編集用`savePlanDraft`の外部挙動は維持する。共通private helperへの抽出は許可するが、週間承認からeditor stateを参照しない。

## 11. 触らない範囲

- 手動editorの画面遷移、notice、recurring edit UX
- memo markerによるdedupeの恒久修正
- server-side approval claim
- scheduler、preview生成、承認前検証
- CSSと表示文言

## 12. 受け入れ条件

- 選択週外の日付を含む複数blockを承認しても、`selectedDate`、`monthDate`、`weekStartDate`が変化しない。
- 全item処理中に同じ`pendingApproval.requestId`が維持される。
- 保存成功後に`complete_approval`が適用され、保存済みblockがdraft一覧から除去される。
- editorが開いている場合やrecurring plan編集中でも、週間承認はeditor対象を上書きせずscope dialogを開かない。
- ledgerの`savedPlanId`が永続化された`Plan.id`と一致する。
- 後続itemの保存失敗時、rollbackは失敗したitemのoptimistic entryだけを除去し、先行して保存成功したitemを`plans`から消さない。
- 保存失敗時の部分再試行を維持する。
- per-item noticeを出さず、週間計画側の集約メッセージだけを表示する。

## 13. テスト観点

- unit: 保存専用関数が画面stateとeditor stateを変更せず、永続Plan IDを返す。
- unit: item失敗のfunctional rollbackが、同一承認内の先行itemのoptimistic entryへ影響しない。
- integration: next-week相当の複数block承認でstate key、pending ownership、完了messageを確認する。
- browser/manual: 現在週から来週の仮予定を承認し、画面が飛ばず、来週へ移動すると保存planが存在する。
- regression: 同一週承認、保存失敗rollback、部分再試行、二重承認拒否。
- property/fuzz: 不要。

## 14. リスク

- 保存処理を複製するとrollbackやvalidationが分岐するため、可能なら副作用なしcoreを共有し、UI副作用を手動保存側で後置する。
- closureで捕捉した`previousPlans`全体へのrollbackを共有coreへ持ち込むと、複数item承認で永続データと画面stateが乖離する。
- `Plan.id`返却契約は後続server-side idempotency taskが利用するため、擬似IDへ戻さない。

## 15. Dependencies

- 先行推奨: `20260718-weekly-planning-application-behavior-tests.md`。
- 後続: `20260716-weekly-planning-approval-persistence-and-idempotency.md`。
- 並行変更禁止: `weeklyPlanningApprovalApplication.ts`を変更するvalidation binding、inflight interruption taskとは直列に実施する。

## 16. Exit conditions

- focused test、週間計画suite、全test、TypeScript、production build、`git diff --check`が成功する。
- 実ブラウザ未確認の場合はIssue #43へ残項目を同期する。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
