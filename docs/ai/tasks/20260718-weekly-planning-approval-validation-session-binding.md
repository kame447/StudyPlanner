# 承認前検証を実セッション値へ接続する

Status: planned
Priority: P1
Requirement IDs: DA-TURN-001, DA-PREVIEW-001
Updated: 2026-07-18
Depends on: `20260716-weekly-planning-entrypoint-request-ownership.md`のimplemented部分

## 1. 背景

2026-07-18の監査で、turn controllerが発行したconversation identityがpreviewとapprovalまで伝播せず、承認applicationが検証入力を捏造していることを確認した。

観測事実:

- controller sessionは`weekly-conversation-<uuid>`を発行する。
- `useWeeklyPlanningApplication`のexecute callbackは`pending.conversationId`を受け取るが、`executeWeeklyPlanningTurn`へ渡していない。
- executorはpipeline optionsへconversationIdを渡さず、pipelineは`weekly-planning-session`へfallbackする。
- previewMetadataとmodule singleton runtimeが同じ定数conversationIdを使うため、conversation mismatch検証が形骸化する。
- approval applicationはpreview自身のstateRevisionをcurrent値として渡し、assumption dependencyを全てpendingのfake recordへ変換する。
- approval経路は未ログイン時にも`anonymous` ownerで開始できる。

## 2. 目的

turn envelope、pipeline、previewMetadata、runtime、approvalが同一の実conversationIdを使用する。承認検証は同じrevision単位と実proposal recordを使い、application層からfake値を排除する。

## 3. 計画書との対応

- product spec: `docs/weekly-planning/weekly-planning-spec.md`の仮定確認と承認gate
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`のpreview authorizationとrequest ownership
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: DA-TURN-001, DA-PREVIEW-001

## 4. Entry conditions

- `20260716-weekly-planning-entrypoint-request-ownership.md`のimplementation recordを確認する。browser verification pendingは本taskのblockerではない。
- conversationIdはmutableなcontroller session refから読み直さず、当該turnの`pending.conversationId`を正として渡す。
- preview `stateRevision`が`PlanningState.revision`ではなくintakeの`sourceTurns.length`系であることを確認する。
- legacy metadataなしblockとbehavior metadataありblockの検証契約を分けて確認する。

## 5. 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.ts`
  - `src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts`
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningBehaviorAwareIntakePipeline.ts`
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts`
  - 必要なら`src/features/weeklyPlanning/planning/weeklyPlanningApproval.ts`の引数名・型
- 新規: なし
- テスト:
  - executor→pipeline conversationId伝播
  - conversation mismatch
  - intake revision mismatch
  - actual proposal status
  - 未ログインguard

## 6. 現在の処理経路

```text
submitWeeklyPlanningControlledTurn
→ pending.conversationId = weekly-conversation-<uuid>
→ execute callback
→ executeWeeklyPlanningTurn(conversationIdなし)
→ behavior pipeline fallback = weekly-planning-session
→ previewMetadata/runtime = fallback定数

approveDraftBlocks
→ current revision = preview自身のrevision
→ proposalRecords = fake pending records
→ runtimeが存在する場合だけ実値へ上書き
```

## 7. 確認済みの事実

- preview/runtimeのrevisionはintake stateの`sourceTurns.length`を基準にしている。
- `PlanningState.revision`はreducer actionごとに進む別のrevision domainであり、そのままpreview revisionと比較できない。
- runtimeがある通常経路ではruntime側のrevision/proposal recordsが使用されるが、conversationIdが定数のため会話別所有権を保証しない。
- block userIdとauthorizedUserIdの一致検証は既に存在する。
- storageはsession-only proposal recordsを除去するため、reload後のbehavior previewはruntimeなしでfail-closedになる。

## 8. 未確認事項

- traceの`logicalConversationId`とcontroller conversationIdを同一値にするか、相関IDとして別に維持するか。
- deterministic/legacy exam previewでmetadataがない場合のcurrent intake revision fixture。

## 9. 問題点

- request ownershipのidentityがpreview authorization境界へ届いていない。
- revision単位が明記されておらず、`PlanningState.revision`を渡す誤修正が起こり得る。
- domain validatorのfallback入力をapplication層が捏造している。

## 10. 修正方針

1. `WeeklyPlanningTurnExecutionInput`へconversationIdを追加し、`useWeeklyPlanningApplication`はexecute callbackの`pending.conversationId`を渡す。
2. executorはAI/rules両pipeline optionsへconversationIdを渡す。
3. production entrypointではpipelineのfallback定数を使用しない。低レベルunit test向けdefaultを残す場合も、production callが必ず実IDを渡すtestを追加する。
4. behavior metadataありpreviewはruntimeとのconversationId、intake revision、proposal records一致を必須とする。
5. applicationからfake proposal record生成を削除し、`snapshot.intakeState?.assumptionProposalRecords ?? []`を渡す。
6. current revision fallbackが必要なlegacy経路では、`snapshot.intakeState?.sourceTurns.length ?? 0`を用いる。`snapshot.revision`は使用しない。
7. 引数名を変更できる場合は`currentStateRevision`を`currentIntakeRevision`等へ改め、revision domainを型と名称で明示する。
8. `approveDraftBlocks`冒頭で`!userId`を拒否し、`anonymous` fallbackでapprovalを実行しない。

## 11. 触らない範囲

- runtime snapshotの永続化
- restored draftのUI方針
- approval判定規則のfail-closed緩和
- scheduler、保存primitive、trace privacy

## 12. 受け入れ条件

- 同一turnのpending envelope、executor input、pipeline options、previewMetadata、runtimeが同じconversationIdを持つ。
- 会話Aのpreviewを会話Bのruntime下で承認するとstaleとして拒否される。
- intakeのturn数が変わったpreviewはrevision mismatchで拒否される。
- `PlanningState.revision`とpreview revisionを直接比較するproduction codeがない。
- actual proposal recordがacceptedならpending扱いされず、実際にpendingの場合だけ承認を拒否する。
- fake `weekly-planning-session`、fake duration record、preview自身とのrevision自己比較がapproval production pathから消える。
- 未ログイン状態ではapproval operationを開始しない。
- legacy metadataなしblockの互換経路を維持する。

## 13. テスト観点

- unit: pending.conversationIdのexecutor/pipeline伝播、revision domain、proposal record入力。
- integration: reset後の新会話runtimeで旧preview承認拒否、accepted/pending proposalの分岐。
- browser/manual: reset後の旧previewが保存されず、再計算案内になる。
- regression: 通常生成→draft昇格→承認、部分失敗再試行、legacy exam preview。
- property/fuzz: 不要。

## 14. リスク

- 実conversationIdを必須化すると、旧localStorageの定数ID付きbehavior previewは承認不能になる。これはfail-closedとし、restored draft lifecycle taskでUIを一致させる。
- `PlanningState.revision`とintake revisionの混同をtest fixtureにも持ち込まない。

## 15. Dependencies

- 先行契約: `20260716-weekly-planning-entrypoint-request-ownership.md`のcontroller/envelope implementation。browser確認完了は不要。
- 後続: `20260718-weekly-planning-restored-draft-approval-lifecycle.md`、`20260716-weekly-planning-approval-persistence-and-idempotency.md`。
- 並行変更禁止: `weeklyPlanningApprovalApplication.ts`を触るsave isolation、inflight interruption taskとは直列に実施する。

## 16. Exit conditions

- focused test、週間計画suite、全test、TypeScript、production build、`git diff --check`が成功する。
- conversationIdとintake revisionの流れを最終報告で説明する。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
