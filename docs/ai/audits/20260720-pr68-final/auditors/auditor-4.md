# StudyPlanner PR #68 独立監査人4 最終報告

## 監査対象HEAD

- 対象ブランチ: `agent/fix-weekly-planning-trace-and-dialogue-final`
- 対象HEAD: `23d7676370b3efebc8d1465dfd01abc32c6462ca`
- 比較元: `origin/main`
- 開始時状態: clean（`git status -sb` は追跡ブランチ行のみ）

## 担当領域

preview候補生成、previewからdraft blockへの昇格、pending approval、複数件承認、Plan永続化、provenance、client/server operation ledger、complete approval、部分成功・失敗・再試行、二重実行、modal close、component unmount、遅延Promise、selectedDate/週変更、再読込後の復旧を監査した。

## 調査主要ファイル

- `src/components/NaturalLanguageAssistant.tsx`
- `src/App.tsx`
- `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningApprovalAvailability.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningApprovalLedgerStorage.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository.ts`
- `src/features/weeklyPlanning/planning/weeklyPlanningApproval.ts`
- `src/features/weeklyPlanning/planning/weeklyPlanningInterruptibleApproval.ts`
- `src/features/weeklyPlanning/planning/weeklyPlanningPlanProvenance.ts`
- `src/features/weeklyPlanning/preview/weeklyPlanningPreviewBlocks.ts`
- `src/features/weeklyPlanning/useWeeklyPlanningState.ts`
- `src/features/weeklyPlanning/weeklyPlanningReducer.ts`
- `src/features/weeklyPlanning/weeklyPlanningStorage.ts`
- `src/features/weeklyPlanning/weeklyPlanningTurnController.ts`
- `src/features/weeklyPlanning/pipeline/weeklyPlanningBehaviorAwareIntakePipeline.ts`
- 関連するapplication、preview lifecycle、rules/controller integration、repository recovery tests

## 追跡した制御フロー

### 複数ターンから通常保存完了まで

1. `submitWeeklyPlanningControlledTurn` が週scopeのsnapshotに `begin_turn` を適用する。
2. executor/pipelineが intake state と `draftCandidates` を返し、`commit_turn` が `previewCandidates` に保持する。
3. `NaturalLanguageAssistant.handlePromoteWeeklyPreviewToDrafts` が候補を `WeeklyPlanDraftBlock` に変換し、`add_draft_blocks` がpreviewを消してdraftを保持する。
4. `approveWeeklyPlanningDraftBlocks` が全draft IDを固定して `begin_approval` し、preview metadata/runtime guardを通す。
5. deterministic operation IDを作成またはclient ledgerから再利用し、`executeInterruptibleWeeklyDraftApproval` が各blockを逐次保存する。
6. 各Planには `sourceType=weekly-planning` と、operation ID + source block IDから成る `sourceId`、memo markerが付く。Firestore経路はPlan・operation item・operation親をtransactionで保存する。
7. 全itemが `saved`/`skipped_duplicate` のときだけresultがcompletedとなり、server operation completion後に `complete_approval` がdraftを除去して完了messageを追加する。

### 複数件の途中で週を変更する経路

1. 1件目のsave Promise中に `selectedDate` が別週へ変わる。
2. `useWeeklyPlanningState` のscope effectが新週stateを `load_state` 相当でrefへ置換する。pending approvalは週storageから意図的に除外されている。
3. 1件目save成功後、`shouldContinue: () => ownsPendingApproval(getState(), pending)` がfalseとなり、2件目以降を実行しない。
4. resultは`partially_saved`としてclient ledger更新対象になるが、applicationは現stateがpendingを所有しないため、server completion、`complete_approval`、failure throw/messageの前にreturnする。

## 実行テスト / 再現

- 実コードによる静的制御フロー追跡。
- 既存focused再現 `weeklyPlanningApprovalApplication.test.ts` の「stops before the second save after the selected week is replaced」（204-244行）を確認。この再現は、1件目だけが保存され、resultがpartially_saved、現週のpending/messageが消え、Promise自体はresolveする現挙動を明示している。
- `weeklyPlanningApprovalApplication.serverCompletion.test.ts` は同一runtime内のserver finalization retryのみ、`useWeeklyPlanningApplication.test.tsx` のremount testは保存済みoperationなし、repository recovery testは同じoperation ID再利用のみであることを確認した。
- focused test実行試行1: WSLの`npm run test:run -- ...` はNode 12.22.9により `ERR_UNKNOWN_BUILTIN_MODULE: node:fs/promises` で起動前失敗。
- focused test実行試行2: Windows Node 20.20.2直接起動は、Linux側node_modulesにWindows Rollup optional package `@rollup/rollup-win32-x64-msvc` がないため起動前失敗。
- dependency変更・install・一時テスト追加は行っていない。

## BLOCKER

なし。

## MAJOR

### 1. 別週へのselectedDate変更で一括承認が無通知の部分保存になり、pending approvalが復元されない

- ファイル/箇所:
  - `src/features/weeklyPlanning/useWeeklyPlanningState.ts:21-25,48-53`
  - `src/features/weeklyPlanning/weeklyPlanningStorage.ts:571-577,631-633,657-663`
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts:113-117,145-165`
  - `src/features/weeklyPlanning/planning/weeklyPlanningInterruptibleApproval.ts:46-48,71-78`
- 再現条件: 同一承認に2件以上のdraftがあり、1件目の保存Promiseが未完了の間にmodalを閉じて別週へ移動し、その後1件目が成功する。
- 現在挙動: 新週stateへの置換で元pending approvalが消える。1件目成功後に残件処理が停止する。operationはpartially_savedだが、applicationは所有権確認の早期returnによりserver completionも`complete_approval`もfailure message/throwも行わない。元週へ戻ってもpending approvalはstorageから復元されず、ユーザーが状況を知らないまま手動で再承認しない限り残件は保存されない。
- 期待挙動: 一括承認開始時に固定した元週/block群の処理を週表示変更から独立して完了するか、少なくともdurableなpending/partial stateを元週へ復元し、部分保存と再開操作を明示する。全件保存前に成功相当で静かに終了してはならない。
- ユーザー/データ影響: 「一括承認して保存」1回で予定が一部だけ永続化され、画面には成功/失敗が出ない。元週のdraft表示には保存済み1件も残るため、保存済み/未保存の判別もできない。
- 原因: approval継続条件がapplication lifetime/固定operationではなく、現在表示中の週stateが同じephemeral `pendingApproval` を持つことに結合されている一方、そのpendingは週storageから除外される。さらに早期returnがpartial-result通知より前にある。
- 既存テスト未検出理由: 今回追加されたrules/controller結合テストは実際のhookのselectedDate/scopeを変更しない。既存application単体テストは中断そのものを期待しているが、ユーザー可視の復旧・自動残件保存・durable pending契約を検証していない。
- 重要度理由: 通常操作で一括保存が部分コミットされ、ユーザーに通知されず、明示的な再訪・再実行が必要になる実害のある保存契約違反である。

### 2. 保存後の再読込では既存operationを再開できず、再計算が新provenanceを作って重複Planを保存し得る

- ファイル/箇所:
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts:102-110,145-170`
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalAvailability.ts:81-106`
  - `src/features/weeklyPlanning/planning/weeklyPlanningApproval.ts:139-155,200-243`
  - `src/features/weeklyPlanning/weeklyPlanningTurnController.ts:39-50,65-72,117-127`
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningBehaviorAwareIntakePipeline.ts:434-439`
  - `src/features/weeklyPlanning/planning/weeklyPlanningPlanProvenance.ts:17-32`
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository.ts:148-170,173-199,329-368,708-723`
- 再現条件: behavior-aware preview（conversationIdあり）のPlan保存が1件以上成功した後、(a) server `completeOperation` が失敗してdraftが残る、または (b) 複数保存途中でpage reload/unmountする。その後アプリを再読込する。
- 現在挙動: semantic session runtimeは永続化されないため、残ったdraftは`session_runtime_unavailable`で承認を拒否される。client ledgerにcompleted/partial operationが残っていても、既存operationを選ぶ前のpreview guardで停止する。UIの指示どおりdraftを破棄して再計算すると、新controller conversation IDとstate revisionから新preview ID、したがって新approval operation ID/sourceIdが生成される。repositoryの冪等性キーは厳密な `operation ID + source block ID` なので、同じ論理候補でも既保存Planと一致せず、新しいPlanとして保存される。
- 期待挙動: durable ledger/Plan itemを根拠に、既保存itemのreconcileとserver finalization/残件再開をvolatile runtimeなしで実行できること。再計算が必要でも既保存の論理候補を重複作成しないこと。
- ユーザー/データ影響: 通信失敗やreload後に復旧手順へ従うだけで、既に成功した学習予定が重複し、残件との区別がつかなくなる。server operationもactiveのまま孤立し得る。
- 原因: semantic preview freshness guardとdurable persistence recoveryが同じ入口に結合され、再開operationをguardより先に認識しない。またprovenance/idempotencyが再計算を跨がないoperation-scoped identityだけで構成される。
- 既存テスト未検出理由: server completion retry testのpreview metadataにはconversationIdがなくruntime-loss guardを通らない。remount testは保存済みoperationを持たない。repository recovery testは同じoperation IDを再利用するため、新conversation/preview IDでの再計算を再現しない。
- 重要度理由: 保存済みユーザーデータの重複を生じる現実的なfailure/reload経路であり、再試行冪等性の中核契約に反する。

## MINOR

なし。

## 誤検知として除外した候補

- modalを閉じるだけなら`useWeeklyPlanningApplication`は`App`所有でmountされたままであり、生成中preview Promiseはstateへcommitされる。単独のmodal closeによる候補消失は確認されなかった。
- 同じ週内の日付変更ではscope keyが変わらず、保存draftの日付は承認開始時のblockから作られるため、別日へ誤保存する経路は確認されなかった。
- 同一render内の承認二重実行は、同期的にstate refへ`pendingApproval`を置くbegin guardにより2本目が開始されない。
- 通常の1item save失敗はitemをfailedとしてledgerへ残し、成功itemだけdraftから除外して同じoperation IDで再試行する。runtimeが維持される限り、この経路の重複保存は確認されなかった。
- `completeWeeklyApprovalOperation` は通常経路ではresult statusがcompletedのときだけ呼ばれ、repositoryもdurable item/Planの存在をtransaction内で確認する。通常のpartial/failed resultをserver completed扱いする経路は確認されなかった。
- 正常完了経路のPlan provenanceはsourceType/sourceId/memo markerへ一貫して付与される。

## 監査完了時git status

`git status -sb` は追跡ブランチ行のみで、未追跡・変更ファイルなし。本体コード、Git index、commit、branch、remoteは変更していない。
