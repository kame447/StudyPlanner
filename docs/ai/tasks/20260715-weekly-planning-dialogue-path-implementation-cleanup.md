# 週間計画の対話経路を既存pipelineへ直接統合する

Status: closed
Parent: `20260715-weekly-planning-dialogue-path-issue-breakdown.md`
Depends on:

- `20260715-weekly-planning-ai-deterministic-baseline.md` closed
- `20260715-weekly-planning-dialogue-action-priority-and-fallback.md` closed
- `20260715-weekly-planning-clarification-context-generalization.md` closed

## 背景

挙動修正と回帰テストは成立していたが、GitHub APIのファイル更新制約を回避する過程で、既存pipelineを`Core`へ複製し、公開wrapperから合成する構成や、一時的なhelper、triggerが追加されていた。

この構成を解消し、挙動修正を維持したまま既存の責務境界へ直接統合した。

## 実施内容

`weeklyPlanningIntakePipeline.ts`と`weeklyPlanningBehaviorAwareIntakePipeline.ts`へclarification context処理を直接統合した。

通常dialogue decisionとclarification decisionの責務を整理し、clarification targetと`lastQuestionContext`の解決元を一意にした。

次の一時構成を削除した。

- `weeklyPlanningIntakePipelineCore.ts`
- `weeklyPlanningBehaviorAwareIntakePipelineCore.ts`
- `weeklyPlanningDialogueManagerCore.ts`
- 直接統合後に不要となったclarification wrapper/helper
- `.agent-integration-trigger`
- 一時cleanup script

## 制約確認

- closed taskで確定した挙動は変更していない
- parserの個別完全一致表現は追加していない
- legacy fallbackをAI成功経路へ戻していない
- action上限や優先順位を元の単純sliceへ戻していない
- `lastQuestionContext`はsession-localのまま維持している
- cleanupを理由とした新しい会話仕様は追加していない

## 完了条件

- [x] core複製が削除されている
- [x] 公開pipelineから別名coreへ委譲していない
- [x] clarification targetとlastQuestionContextの責務が一意である
- [x] 一時trigger、script、検証artifactがPR差分に残っていない
- [x] PRの変更ファイル数と差分量が、実際の機能変更に見合う範囲へ縮小している
- [x] closed taskの回帰テストがすべて維持される

## 検証結果

- `npm run test:run -- src/features/weeklyPlanning`: 688 passed、13 skipped、5 todo
- `npm run build`: passed
- `git diff --check`: passed

## 次のtask

最終検証、PR本文更新、base確認、trackerの終了処理は次で行う。

`20260715-weekly-planning-dialogue-path-pr-finalization.md`
