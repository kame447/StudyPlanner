# 承認前検証を実セッション値へ接続する

Status: planned
Priority: P1
Requirement IDs: DA-TURN-001, DA-PREVIEW-001
Updated: 2026-07-18
Depends on: `20260716-weekly-planning-entrypoint-request-ownership.md`

## 1. 背景

2026-07-18の全体監査で、`validateWeeklyPreviewApproval`へ渡る入力が実セッション値に接続されていないことを確認した。

観測事実:

- `weeklyPlanningTurnExecutor.ts`はpipelineへconversationIdを渡していない。pipelineとpreview bridgeは定数`'weekly-planning-session'`へフォールバックする(`src/features/weeklyPlanning/pipeline/weeklyPlanningBehaviorAwareIntakePipeline.ts:79`)。全ユーザー・全会話・全週で同一値になるため、`validateWeeklyPreviewApproval`の`conversationMismatch`は決して発火しない。
- controller sessionは`weekly-conversation-<uuid>`を発行するが(`weeklyPlanningTurnController.ts`)、previewMetadata・session runtimeのconversationIdとは別系統で、接続されていない。
- 承認application層は`currentStateRevision: firstMetadata?.stateRevision ?? -1`を渡す(`src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts:80`)。これはpreview自身のrevisionを「現在値」とする自己比較であり、runtime不在経路ではstale判定が恒真で素通りする。
- 同application層は全assumptionDependencyを`status: 'pending'`で捏造した`proposalRecords`を渡す(同:65-77)。runtime不在経路では依存があると常に「未確認の仮定」で拒否される。
- staleness防御の実体は、module singletonのsession runtime(`weeklyPlanningSessionRuntime.ts`)の`stateRevision`(= `sourceTurns.length`)との数値一致のみである。別会話・別週のruntimeと偶然一致すればstale previewが承認を通過し得る。
- 承認経路のuserガードが分離時に弱まった。旧`App.tsx`は`if (!user) return;`だったが、現行`useWeeklyPlanningApplication.approveDraftBlocks`は`ownerId`('anonymous'フォールバック)で実行し得る。`submitTurn`は`!userId`で拒否しており非対称。

## 2. 目的

previewの承認可否が、実際の会話ID・実際の状態revision・実際の仮定提案の状態に基づいて判定される。フォールバック定数と捏造値がproduction承認経路から消える。

## 3. 計画書との対応

- product spec: `docs/weekly-planning/weekly-planning-spec.md`(仮定確認と承認ゲート)
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`(preview authorization、request ownership)
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: DA-TURN-001, DA-PREVIEW-001

## 4. Entry conditions

- entrypoint request ownership task(implemented / browser pending)のenvelope設計を確認する。
- conversationIdをexecutor→pipeline→bridge→previewMetadata→runtimeへ通す配線点を列挙する。
- 既存の保存済み仮予定(定数conversationId入りpreviewMetadata)との互換方針を決める(拒否か、legacy扱いか)。

## 5. 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts`(controller sessionのconversationIdを受け取りpipelineへ渡す)
  - `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.ts`(executorへconversationIdを渡す。approve時のuserガード追加)
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts`(実revision・実proposalRecordsの受け渡し。捏造recordの削除)
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningBehaviorAwareIntakePipeline.ts`(フォールバック定数の扱い整理)
- 新規: なし
- テスト:
  - `weeklyPlanningApproval`系の既存テストへ、会話不一致・revision不一致・実proposalRecordsのケースを追加

## 6. 現在の処理経路

```text
submitTurn(useWeeklyPlanningApplication)
→ submitWeeklyPlanningControlledTurn(session.conversationId = weekly-conversation-<uuid>)
→ executeWeeklyPlanningTurn(conversationIdを渡していない)
→ pipeline(getConversationId → 'weekly-planning-session')
→ runHardenedBehaviorAwarePlanningPreviewBridge
→ publishWeeklyPlanningSessionRuntime(定数conversationId)
→ previewMetadata.conversationId = 定数

approveDraftBlocks
→ validateWeeklyPreviewApproval(捏造proposalRecords、自己比較revision)
→ runtime存在時のみruntime値で上書き
```

## 7. 確認済みの事実

- runtimeが存在する通常経路では、staleness判定はruntime.stateRevisionとの一致で機能している(定数conversationIdのため会話別の判定はない)。
- `authorizedUserId`とblockごとの`userId`一致チェックは機能しており、別ユーザーのblock承認は拒否される。
- 全テスト1163件はこの状態で成功しており、既存テストは定数conversationIdを前提にしたfixtureを使っている。

## 8. 未確認事項

- 実AI interpreter経路(`runWeeklyPlanningBehaviorAwarePipelineWithInterpreter`)でのconversationId伝播に追加の分岐がないか。
- trace系(`logicalConversationId`)との相関付けへの影響。

## 9. 問題点

- 会話所有権の統一(コミット83238cf、entrypoint request ownership task)がpreview/approval層まで届いておらず、検証契約が名目化している。
- application層がdomain検証の入力を捏造しており、検証の実効性が呼び出し側の作り方に依存する。

## 10. 修正方針

- 配線の修正であり、検証ロジック自体の意味は変えない。
  1. controller sessionのconversationIdをexecutor経由でpipeline optionsへ渡す。previewMetadata・runtime・turn envelopeが同一のconversationIdを持つ。
  2. 承認application層は、reducerの現在stateから実際のrevisionと実際の`assumptionProposalRecords`(intakeState由来。session-onlyであることに留意)を渡す。渡せない場合はruntime必須へ契約を明確化し、捏造recordを削除する。
  3. `approveDraftBlocks`冒頭に`if (!userId) return;`相当のガードを追加し、`submitTurn`と対称にする。
- 互換: 既存localStorage内の定数conversationId付き仮予定は、restored-draft lifecycle task(別task)の方針に従い、ここでは「stale扱いで再計算を促す」以上の特別対応をしない。

## 11. 触らない範囲

- `validateWeeklyPreviewApproval`の判定規則そのもの
- session runtimeの永続化(`20260718-weekly-planning-restored-draft-approval-lifecycle.md`の範囲)
- scheduler、preview生成条件、保存境界
- trace privacy

## 12. 受け入れ条件

- 会話Aで生成した仮予定を、会話B(reset後の新session)のruntime下で承認しようとすると`stale_preview_approval_attempt`で拒否される。
- previewMetadata.conversationId、runtime.conversationId、turn envelopeのconversationIdが同一sessionで一致する。
- 承認前検証へ渡るproposalRecordsが、intakeStateの実際の提案状態を反映する。pending提案が実際に残っている場合のみ「未確認の仮定」で拒否される。
- `currentStateRevision`の自己比較(`?? -1`フォールバック含む)がproduction経路から消える。
- 未ログイン状態で`approveDraftBlocks`が実行されない。
- 既存の正常承認・部分失敗再試行・legacy exam previewの経路が通る。

## 13. テスト観点

- unit: executor→pipelineのconversationId伝播。approvalへの実revision/実record受け渡し。
- integration: reset→新会話→旧仮予定の承認拒否。pending提案あり/解決済みでの承認可否。
- browser/manual: 会話リセット後に古い仮予定を承認できないこと、エラーメッセージが再計算を促すこと。
- regression: 通常の生成→昇格→承認→保存のhappy path。legacy previewId経路。
- property/fuzz: 不要。

## 14. リスク

- conversationIdの一致要求を強めることで、既存ユーザーのlocalStorage内仮予定が承認不能になる(意図的なfail-closed)。メッセージが再計算導線を示すことを確認する。
- 実proposalRecordsはstorage保存時にstripされる(session-only)。リロード後経路の扱いはrestored-draft taskへ委譲し、本taskでfail-openにしない。

## 15. Dependencies

- 先行: `20260716-weekly-planning-entrypoint-request-ownership.md`(envelope設計)。
- 並行変更禁止: `weeklyPlanningApprovalApplication.ts`を触る他の20260718系taskと直列にする。

## 16. Exit conditions

- focused test、週間計画suite、全test、TypeScript、production build、`git diff --check`が成功する。
- conversationIdの流れ(controller→executor→pipeline→preview→runtime→approval)を1つの図で説明できる。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
